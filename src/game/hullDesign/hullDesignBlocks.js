// src/game/hullDesign/hullDesignBlocks.js
//
// KREATOR KADŁUBÓW — KLOCKI (czyste: bez three i DOM). Paleta prostych kształtów, z których gracz składa każdy kadłub
// (także flotę Terra Novy): prostokąt (z fazą osobno na każdy róg), trapez (prostokątny, równoramienny, równoległobok),
// trójkąt (prostokątny, klin) i łuk (koło, półkole, ćwiartka, pierścień). Mało rodzajów, kształt z parametrów.
//
// Klocek w projekcie to bryła `shapes` o rodzaju 'block':
//   { kind: 'block', shape: 'rect' | 'trap' | 'tri' | 'arc', x, y (środek [j.]), w, h (PEŁNE wymiary w układzie klocka
//     [j.] — inaczej niż 'rect' i kasztele, które mają pół-wymiary), rot (obrót [rad], zawsze wielokrotność 45°),
//     flip (odbicie lewo-prawo w układzie klocka, przed obrotem), level (0 rama … 3 mostek; domyślnie 1 — pancerz),
//     op ('add' | 'cut'), gap (szczelina płyty [jd]; brak — HD_BLOCK_TUNE.gapDu, 0 — płyta scala się z sąsiadem),
//     mirror (false — bez kopii po drugiej burcie),
//     rect: c [4] — fazy rogów [j.] (lewy-górny, prawy-górny, prawy-dolny, lewy-dolny),
//     trap: a, b — górna krawędź wcięta o a z lewej i o b z prawej [j.] (ujemne — wysunięta; równoległobok: a = −b),
//     tri:  a — wierzchołek na górnej krawędzi, a [j.] od lewego rogu (0 — trójkąt prostokątny, w / 2 — klin),
//     arc:  arc (90 | 180 | 360 [°]: ćwiartka z rogiem w lewym-dolnym rogu pudła, półkole na dolnej krawędzi, koło —
//           elipsa wpisana w pudło), ri (pierścień: promień wewnętrzny jako ułamek zewnętrznego) }.
// Układ klocka: x w prawo (przy rot 0 — ku dziobowi), y w dół (jak projekt), środek pudła w (0, 0).
//
// SIATKA: położenia i wymiary klocków są w j. świata na siatce projektu `design.grid` [j.] — krok ustalany przy
// tworzeniu projektu z jego detalu (hullDesignGridStep: ~4 jd, potęga dwójki), potem stały. Suwak `detail` zmienia
// gęstość detalu (płyty, nity, rury, szerokość rowów w jd), ale NIE rozmiar okrętu ani położenie klocków.
//
// ROZWINIĘCIE (expandHullBlocks, wołane z expandHullDesign): klocki zamieniają się na zwykłe wielokąty 'poly', więc
// fazy, poziomy, pola i reszta kreatora o klockach nie wie:
//   - RAMA (poziom 0, sylwetka) — suma PEŁNYCH obrysów wszystkich klocków dodających (z kopiami lustra),
//   - PŁYTY poziomu L = 1…3 — suma płyt klocków z poziomem ≥ L; płyta klocka = jego obrys bez pasa pół szczeliny
//     (gap / 2 jd) wokół SĄSIEDNICH klocków-płyt: między sąsiadami zostaje rów maszynowni szerokości gapA / 2 + gapB / 2
//     (tędy pójdą rury i kable), przy burcie — cienki brzeg ramy (rimDu jd, przycięcie do pola ramy: clip 0 + clipIn);
//     klocki nachodzące na siebie dają jedną płytę, gap 0 po obu stronach — płyty scalone przez styk,
//   - WYCIĘCIA poziomu L — suma klocków-wycięć z poziomem ≤ L (wycięcie na poziomie L usuwa poziomy ≥ L; klocki-wycięcia
//     tną wszystkie klocki dodające, kolejność wśród klocków nie gra roli).
// Sumy są GEOMETRYCZNE (polygonUnion — odcinki obrysów poza innymi wielokątami, sklejone w pętle), nie min pól:
// dwa wielokąty stykające się krawędzią dawałyby w polu linię zera na styku (szew: rowek w płycie, półprzezroczysta
// kreska w alfie).

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

export const HD_BLOCK_SHAPES = Object.freeze(['rect', 'trap', 'tri', 'arc']);
export const HD_BLOCK_SHAPE_NAMES = Object.freeze({ rect: 'prostokąt', trap: 'trapez', tri: 'trójkąt', arc: 'łuk' });
export const HD_BLOCK_ARCS = Object.freeze([90, 180, 360]);
/** Krok obrotu klocka [rad]. */
export const HD_BLOCK_ROT_STEP = Math.PI / 4;

/**
 * Strojenie klocków: `gapDu` — domyślna szczelina płyty [jd] (rów maszynowni między płytami; obrys sprite'ów TN:
 * mediana 16–23 jd, dolny kwartyl 10–15), `rimDu` — brzeg ramy przy burcie [jd] (płyty TN dochodzą prawie do
 * sylwetki: mediana 0,7–2,4 jd), `gridDu` — krok siatki projektu ≈ tyle jd (zaokrąglony do potęgi dwójki j.), fazy
 * rogów sum [jd]: płyt (`plateChDu`) i ramy (`frameChDu`), `arcStepDeg` — krok łuku wielokąta [°], `eps` — tolerancja
 * operacji na wielokątach (ułamek rozmiaru współrzędnych).
 */
export const HD_BLOCK_TUNE = Object.freeze({
  gapDu: 12,
  rimDu: 1.5,
  gridDu: 4,
  plateChDu: 1.2,
  frameChDu: 0.6,
  arcStepDeg: 4,
  eps: 1e-6
});

/**
 * PALETA (kolejność panelu edytora): kształt i parametry w jednostkach palety `u` (edytor: hullBlockPaletteUnit —
 * wielokrotność dwóch kroków siatki) — fazy i wierzchołki wypadają na siatce. Mało rodzajów (rect / trap / tri / arc), wpis palety
 * to tylko ustawienie parametrów.
 */
export const HD_BLOCK_PALETTE = Object.freeze([
  Object.freeze({ id: 'rect', label: 'Prostokąt', shape: 'rect', w: 4, h: 2 }),
  Object.freeze({ id: 'rect_ch', label: 'Prostokąt ze ściętymi rogami', shape: 'rect', w: 4, h: 2, c: [0.5, 0.5, 0.5, 0.5] }),
  Object.freeze({ id: 'tri', label: 'Trójkąt prostokątny', shape: 'tri', w: 3, h: 2, a: 0 }),
  Object.freeze({ id: 'wedge', label: 'Klin (dziób)', shape: 'tri', w: 4, h: 2, a: 2 }),
  Object.freeze({ id: 'trap_r', label: 'Trapez prostokątny', shape: 'trap', w: 4, h: 2, a: 0, b: 2 }),
  Object.freeze({ id: 'trap_i', label: 'Trapez równoramienny', shape: 'trap', w: 4, h: 1.5, a: 1.5, b: 1.5 }),
  Object.freeze({ id: 'para', label: 'Równoległobok', shape: 'trap', w: 4, h: 1.5, a: 1.5, b: -1.5 }),
  Object.freeze({ id: 'circle', label: 'Koło', shape: 'arc', w: 3, h: 3, arc: 360 }),
  Object.freeze({ id: 'half', label: 'Półkole', shape: 'arc', w: 4, h: 2, arc: 180 }),
  Object.freeze({ id: 'quarter', label: 'Ćwiartka koła', shape: 'arc', w: 2, h: 2, arc: 90 }),
  Object.freeze({ id: 'ring', label: 'Pierścień', shape: 'arc', w: 3, h: 3, arc: 360, ri: 0.6 })
]);
export const HD_BLOCK_PALETTE_IDS = Object.freeze(HD_BLOCK_PALETTE.map((p) => p.id));

/** Krok siatki klocków [j.] dla projektu o detalu `detail` [j./jd]: ~gridDu jd, potęga dwójki (fregata 0,5, Colossus 4). */
export function hullDesignGridStep(detail) {
  const g = HD_BLOCK_TUNE.gridDu * Math.max(0.01, num(detail, 0.6));
  return 2 ** Math.round(Math.log2(g));
}

/** Jednostka palety [j.]: wielokrotność dwóch kroków siatki najbliższa ~24 jd (fregata 2 j., Colossus 24 j.). */
export function hullBlockPaletteUnit(grid, detail) {
  const g2 = 2 * grid;
  return Math.max(g2, Math.round((24 * detail) / g2) * g2);
}

/** Obrót przyciągnięty do wielokrotności 45° w [0, 2π) (k · π/4; k = 0 → 0). */
export function snapBlockRot(rot) {
  const k = ((Math.round(num(rot) / HD_BLOCK_ROT_STEP) % 8) + 8) % 8;
  return k === 0 ? 0 : k * HD_BLOCK_ROT_STEP;
}
/** Numer kroku obrotu 0–7. */
export const blockRotStep = (rot) => ((Math.round(num(rot) / HD_BLOCK_ROT_STEP) % 8) + 8) % 8;

/** Klocek po walidacji (null — niepoprawny). `levelShift` — migracja v1 → v2 (jak bryły). */
export function normalizeBlock(s, levels = 4, levelShift = 0) {
  if (!s || s.kind !== 'block') return null;
  const shape = HD_BLOCK_SHAPES.includes(s.shape) ? s.shape : 'rect';
  const out = {
    kind: 'block', shape, op: s.op === 'cut' ? 'cut' : 'add',
    level: clamp(Math.round(num(s.level, 1) + levelShift), 0, levels - 1),
    x: num(s.x), y: num(s.y), w: Math.max(0.01, num(s.w, 40)), h: Math.max(0.01, num(s.h, 20)), rot: snapBlockRot(s.rot)
  };
  if (s.flip === true) out.flip = true;
  if (shape === 'rect' && Array.isArray(s.c)) {
    const lim = Math.min(out.w, out.h) / 2;
    const c = [0, 1, 2, 3].map((i) => clamp(num(s.c[i]), 0, lim));
    if (c.some((v) => v > 0)) out.c = c;
  } else if (shape === 'trap') {
    // skosy do ±(w + 4h): stromy równoległobok (a = −b) też jest trapezem
    const lim = out.w + 4 * out.h;
    let a = clamp(num(s.a), -lim, lim), b = clamp(num(s.b), -lim, lim);
    if (a + b > out.w) { const k = out.w / (a + b); a *= k; b *= k; }   // górna krawędź nie krótsza niż 0
    out.a = a; out.b = b;
  } else if (shape === 'tri') {
    out.a = clamp(num(s.a), 0, out.w);
  } else if (shape === 'arc') {
    const want = num(s.arc, 360);
    out.arc = HD_BLOCK_ARCS.reduce((best, v) => (Math.abs(v - want) < Math.abs(best - want) ? v : best), 360);
    const ri = clamp(num(s.ri), 0, 0.95);
    if (ri > 1e-3) out.ri = ri;
  }
  if (s.gap !== undefined && out.op === 'add') out.gap = clamp(num(s.gap, HD_BLOCK_TUNE.gapDu), 0, 80);
  if (s.mirror === false) out.mirror = false;
  return out;
}

// ---------------------------------------------------------------------------
// Wielokąty klocka

function ellipseArc(cx, cy, rx, ry, t0, t1, stepDeg) {
  const n = Math.max(2, Math.ceil(Math.abs(t1 - t0) / (stepDeg * Math.PI / 180)));
  const out = [];
  for (let k = 0; k <= n; k++) {
    const t = t0 + (t1 - t0) * (k / n);
    out.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
  }
  return out;
}

function dedupe(loop, eps = 1e-9) {
  const out = [];
  for (const p of loop) {
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) < eps && Math.abs(q[1] - p[1]) < eps) continue;
    out.push(p);
  }
  while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < eps && Math.abs(out[0][1] - out[out.length - 1][1]) < eps) out.pop();
  return out;
}

/**
 * Pętle klocka w JEGO układzie (środek pudła w 0, 0; bez obrotu i odbicia): [obrys, …otwory]. Obrys dodatni
 * (wzór pola Gaussa w układzie y w dół > 0 — wnętrze po stronie (−dy, dx) krawędzi), otwór ujemny.
 */
export function blockLocalLoops(b, stepDeg = HD_BLOCK_TUNE.arcStepDeg) {
  const hw = b.w / 2, hh = b.h / 2;
  if (b.shape === 'trap') {
    const a = b.a || 0, bb = b.b || 0;
    return [dedupe([[-hw + a, -hh], [hw - bb, -hh], [hw, hh], [-hw, hh]])];
  }
  if (b.shape === 'tri') return [dedupe([[-hw + (b.a || 0), -hh], [hw, hh], [-hw, hh]])];
  if (b.shape === 'arc') {
    const ri = b.ri || 0;
    if (b.arc === 360) {
      const outer = ellipseArc(0, 0, hw, hh, 0, 2 * Math.PI, stepDeg);
      outer.pop();
      if (!(ri > 0)) return [outer];
      const inner = ellipseArc(0, 0, hw * ri, hh * ri, 2 * Math.PI, 0, stepDeg);
      inner.pop();
      return [outer, inner];
    }
    // półkole: środek na dolnej krawędzi pudła, łuk ku górze; ćwiartka: środek w lewym-dolnym rogu, łuk ku prawej-górze
    const half = b.arc === 180;
    const cx = half ? 0 : -hw, cy = hh, rx = half ? hw : b.w, ry = b.h;
    const t0 = half ? Math.PI : 1.5 * Math.PI, t1 = 2 * Math.PI;
    const outer = ellipseArc(cx, cy, rx, ry, t0, t1, stepDeg);
    if (ri > 0) return [dedupe([...outer, ...ellipseArc(cx, cy, rx * ri, ry * ri, t1, t0, stepDeg)])];
    if (!half) outer.push([cx, cy]);
    return [dedupe(outer)];
  }
  // prostokąt z fazą osobno na każdy róg (lewy-górny, prawy-górny, prawy-dolny, lewy-dolny)
  const c = b.c || [0, 0, 0, 0];
  return [dedupe([
    [-hw, -hh + c[0]], [-hw + c[0], -hh],
    [hw - c[1], -hh], [hw, -hh + c[1]],
    [hw, hh - c[2]], [hw - c[2], hh],
    [-hw + c[3], hh], [-hw, hh - c[3]]
  ])];
}

const R9 = (v) => Math.round(v * 1e9) / 1e9;

/** Pętle klocka w układzie projektu (obrót, odbicie, położenie); kopia lustra (`mirrored`) — y → −y. Obieg jak wyżej. */
export function blockWorldLoops(b, mirrored = false, stepDeg = HD_BLOCK_TUNE.arcStepDeg) {
  const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
  const fx = b.flip ? -1 : 1, fy = mirrored ? -1 : 1;
  const flipOrder = (fx * fy) < 0;
  return blockLocalLoops(b, stepDeg).map((loop) => {
    const out = loop.map(([lx0, ly]) => {
      const lx = lx0 * fx;
      return [R9(b.x + lx * c - ly * s), R9((b.y + lx * s + ly * c) * fy)];
    });
    return flipOrder ? out.reverse() : out;
  });
}

/** Pole ze znakiem łamanej zamkniętej (wzór Gaussa; > 0 — obrys w konwencji klocków). */
export function loopArea(loop) {
  let a = 0;
  for (let i = 0, n = loop.length; i < n; i++) {
    const p = loop[i], q = loop[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a * 0.5;
}

/** Pole klocka [j.²] (obrys − otwory). */
export function blockArea(b) {
  let a = 0;
  for (const l of blockLocalLoops(b)) a += loopArea(l);
  return a;
}

/**
 * Pętla przesunięta o `e` [j.]: e > 0 — w stronę wnętrza (strona (−dy, dx) krawędzi: obrys się kurczy, otwór rośnie),
 * e < 0 — na zewnątrz (poszerzenie). Proste krawędzi przesunięte, wierzchołki z przecięć sąsiednich prostych; krawędź,
 * która się odwróciła (zanikła), odpada i liczy się od nowa. Przy poszerzaniu szpic ostrego rogu dłuższy niż
 * `bevel` · |e| jest ścięty (dwa punkty zamiast szpica). Null — pętla zanikła.
 */
export function offsetLoop(loop, e, bevel = 1.5) {
  if (!e) return loop.map((p) => p.slice());
  let lines = [];
  for (let i = 0, n = loop.length; i < n; i++) {
    const p = loop[i], q = loop[(i + 1) % n];
    const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.sqrt(dx * dx + dy * dy);
    if (L < 1e-12) continue;
    const ux = dx / L, uy = dy / L;
    lines.push({ px: p[0] - uy * e, py: p[1] + ux * e, ux, uy });
  }
  const a0 = loopArea(loop);
  for (let guard = 0; guard < loop.length + 2; guard++) {
    const n = lines.length;
    if (n < 3) return null;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const A = lines[(i - 1 + n) % n], B = lines[i];
      const den = A.ux * B.uy - A.uy * B.ux;
      if (Math.abs(den) < 1e-12) { pts.push([B.px, B.py]); continue; }   // współliniowe — punkt prostej
      const t = ((B.px - A.px) * B.uy - (B.py - A.py) * B.ux) / den;
      pts.push([A.px + A.ux * t, A.py + A.uy * t]);
    }
    // krawędź i (pts[i] → pts[i + 1]) leży na prostej i — zgodny kierunek albo odpada
    const drop = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      if ((q[0] - p[0]) * lines[i].ux + (q[1] - p[1]) * lines[i].uy <= 1e-12) drop.push(i);
    }
    if (!drop.length) {
      const a = loopArea(pts);
      if (Math.sign(a) !== Math.sign(a0) || Math.abs(a) < 1e-9) return null;
      if (e > 0) return pts;
      // poszerzenie: szpic rogu wypukłego (skręt ku wnętrzu) ścięty prostopadle do dwusiecznej
      const out = [];
      const m0 = -e, cut = bevel * m0;
      for (let i = 0; i < n; i++) {
        const A = lines[(i - 1 + n) % n], B = lines[i];
        const cr = A.ux * B.uy - A.uy * B.ux, dt = A.ux * B.ux + A.uy * B.uy;
        const half = Math.atan2(Math.abs(cr), dt) * 0.5;                  // połowa kąta skrętu
        const m = m0 / Math.max(Math.cos(half), 1e-6);                    // długość szpica od rogu
        if (cr <= 0 || m <= cut || Math.sin(half) < 1e-6) { out.push(pts[i]); continue; }
        const P = pts[(i - 1 + n) % n], X = pts[i], N = pts[(i + 1) % n];
        const lenA = Math.hypot(X[0] - P[0], X[1] - P[1]), lenB = Math.hypot(N[0] - X[0], N[1] - X[1]);
        const s = Math.min((m - cut) / Math.sin(half), lenA * 0.45, lenB * 0.45);
        out.push([X[0] - A.ux * s, X[1] - A.uy * s], [X[0] + B.ux * s, X[1] + B.uy * s]);
      }
      return out;
    }
    if (drop.length >= n - 2) return null;
    const set = new Set(drop);
    lines = lines.filter((_, i) => !set.has(i));
  }
  return null;
}

/** Pętla pomniejszona o `e` > 0 (offsetLoop). */
export const insetLoop = (loop, e) => offsetLoop(loop, Math.max(0, e));

// ---------------------------------------------------------------------------
// Suma i różnica wielokątów (geometryczne)
//
// Wielokąt = lista pętli [obrys, …otwory] w obiegu klocków (obrys dodatni, otwór ujemny — wnętrze po stronie (−dy, dx)
// każdej krawędzi). Każdą krawędź tnie się w punktach przecięcia z krawędziami drugiej strony (i w końcach tamtych
// krawędzi leżących na niej), kawałek klasyfikuje się środkiem: wewnątrz / na zewnątrz / na krawędzi drugiej strony
// o zgodnym albo przeciwnym kierunku. Wybrane kawałki skleja się w pętle.

function segDist2(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const L2 = vx * vx + vy * vy;
  let t = L2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / L2 : 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  const dx = px - ax - vx * t, dy = py - ay - vy * t;
  return dx * dx + dy * dy;
}

function insideLoops(loops, px, py) {
  let inside = false;
  for (const loop of loops) {
    for (let s = 0, n = loop.length, k = n - 1; s < n; k = s++) {
      const a = loop[k], b = loop[s];
      if ((a[1] <= py) !== (b[1] <= py) && px < a[0] + (py - a[1]) / (b[1] - a[1]) * (b[0] - a[0])) inside = !inside;
    }
  }
  return inside;
}

/** Wielokąt przygotowany do operacji: pętle, krawędzie, pudło. */
function prepPoly(loops) {
  const edges = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of loops) {
    for (let s = 0, n = l.length; s < n; s++) {
      const a = l[s], b = l[(s + 1) % n];
      edges.push([a, b]);
      if (a[0] < x0) x0 = a[0]; if (a[0] > x1) x1 = a[0]; if (a[1] < y0) y0 = a[1]; if (a[1] > y1) y1 = a[1];
    }
  }
  return { loops, edges, box: [x0, y0, x1, y1] };
}

const boxesTouch = (a, b, m) => a[0] <= b[2] + m && b[0] <= a[2] + m && a[1] <= b[3] + m && b[1] <= a[3] + m;

/** Tolerancja operacji [j.] z rozmiaru współrzędnych. */
function tolOf(polys, eps) {
  let s = 1;
  for (const p of polys) for (const v of p.box) if (Math.abs(v) > s) s = Math.abs(v);
  return eps * s;
}

/** Parametry podziału krawędzi a → b przez krawędzie wielokątów `cutters`. */
function splitParams(a, b, cutters, E, E2) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  const ex0 = Math.min(a[0], b[0]) - E, ex1 = Math.max(a[0], b[0]) + E, ey0 = Math.min(a[1], b[1]) - E, ey1 = Math.max(a[1], b[1]) + E;
  const ts = [0, 1];
  for (const P of cutters) {
    if (P.box[0] > ex1 || P.box[2] < ex0 || P.box[1] > ey1 || P.box[3] < ey0) continue;
    for (const [c, d] of P.edges) {
      if (Math.max(c[0], d[0]) < ex0 || Math.min(c[0], d[0]) > ex1 || Math.max(c[1], d[1]) < ey0 || Math.min(c[1], d[1]) > ey1) continue;
      if (segDist2(c[0], c[1], a[0], a[1], b[0], b[1]) <= E2) ts.push(((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / L2);
      if (segDist2(d[0], d[1], a[0], a[1], b[0], b[1]) <= E2) ts.push(((d[0] - a[0]) * dx + (d[1] - a[1]) * dy) / L2);
      const fx = d[0] - c[0], fy = d[1] - c[1];
      const den = dx * fy - dy * fx;
      if (Math.abs(den) > 1e-15) {
        const t = ((c[0] - a[0]) * fy - (c[1] - a[1]) * fx) / den;
        const u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / den;
        if (t > 0 && t < 1 && u >= -1e-12 && u <= 1 + 1e-12) ts.push(t);
      }
    }
  }
  return ts.sort((p, q) => p - q);
}

/**
 * Położenie punktu (mx, my) kawałka o kierunku (dx, dy) względem wielokąta P: 2 — na krawędzi P o zgodnym kierunku,
 * −2 — na krawędzi o przeciwnym (styk), 1 — wewnątrz, 0 — na zewnątrz.
 */
function classify(P, mx, my, dx, dy, E2) {
  if (mx < P.box[0] - 1e-9 - Math.sqrt(E2) * 4 || mx > P.box[2] + Math.sqrt(E2) * 4 || my < P.box[1] - Math.sqrt(E2) * 4 || my > P.box[3] + Math.sqrt(E2) * 4) return 0;
  for (const [c, d] of P.edges) {
    if (segDist2(mx, my, c[0], c[1], d[0], d[1]) > E2 * 16) continue;
    const ex = d[0] - c[0], ey = d[1] - c[1];
    const dot = dx * ex + dy * ey, cr = dx * ey - dy * ex;
    if (Math.abs(cr) > 1e-6 * Math.abs(dot) + 1e-15) continue;               // przecięcie w punkcie, nie wspólna krawędź
    return dot > 0 ? 2 : -2;
  }
  return insideLoops(P.loops, mx, my) ? 1 : 0;
}

/** Kawałki krawędzi wielokąta `P` pocięte krawędziami `cutters`, wybrane funkcją keep(mx, my, dx, dy) → odcinki. */
function pieces(P, cutters, E, keep, out, reverse = false) {
  const E2 = E * E;
  for (const [a, b] of P.edges) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.sqrt(dx * dx + dy * dy);
    if (L <= E) continue;
    const ts = cutters.length ? splitParams(a, b, cutters, E, E2) : [0, 1];
    let prev = 0;
    for (let k = 1; k < ts.length; k++) {
      const t1 = Math.min(1, ts[k]);
      if ((t1 - prev) * L <= E * 4) continue;
      const t0 = prev;
      prev = t1;
      const mx = a[0] + dx * (t0 + t1) * 0.5, my = a[1] + dy * (t0 + t1) * 0.5;
      if (!keep(mx, my, dx, dy, E2)) continue;
      const p = [a[0] + dx * t0, a[1] + dy * t0], q = [a[0] + dx * t1, a[1] + dy * t1];
      out.push(reverse ? [q, p] : [p, q]);
    }
  }
}

/**
 * SUMA wielokątów `polys` (każdy — lista pętli) → [{ outer, holes }]: kawałek krawędzi zostaje, gdy leży poza
 * wszystkimi innymi wielokątami; na wspólnej krawędzi o zgodnym kierunku — raz (wielokąt o najniższym numerze),
 * o przeciwnym (styk dwóch wielokątów — szew) znika z obu stron.
 */
export function polygonUnion(polys, eps = HD_BLOCK_TUNE.eps) {
  const P = polys.filter((p) => p && p.length && p[0].length >= 3).map(prepPoly);
  if (!P.length) return [];
  const E = tolOf(P, eps);
  const segs = [];
  for (let i = 0; i < P.length; i++) {
    const others = [];
    for (let j = 0; j < P.length; j++) if (j !== i && boxesTouch(P[i].box, P[j].box, E)) others.push(j);
    pieces(P[i], others.map((j) => P[j]), E, (mx, my, dx, dy, E2) => {
      for (const j of others) {
        const c = classify(P[j], mx, my, dx, dy, E2);
        if (c === 1 || c === -2 || (c === 2 && j < i)) return false;
      }
      return true;
    }, segs);
  }
  return stitchSegments(segs, E);
}

/** RÓŻNICA A − B (A, B — listy pętli; B bez nakładania się pętli, np. wynik sumy) → [{ outer, holes }]. */
export function polygonDifference(A, B, eps = HD_BLOCK_TUNE.eps) {
  const PA = prepPoly(A);
  if (!B || !B.length) return stitchSegments(PA.edges.map(([a, b]) => [a, b]), tolOf([PA], eps));
  const PB = prepPoly(B);
  const E = tolOf([PA, PB], eps);
  const segs = [];
  // krawędzie A poza B (albo na styku z B); krawędzie B wewnątrz A — odwrócone
  pieces(PA, [PB], E, (mx, my, dx, dy, E2) => { const c = classify(PB, mx, my, dx, dy, E2); return c === 0 || c === -2; }, segs);
  pieces(PB, [PA], E, (mx, my, dx, dy, E2) => classify(PA, mx, my, dx, dy, E2) === 1, segs, true);
  return stitchSegments(segs, E);
}

/** Czy wielokąty (listy pętli) mają część wspólną o dodatnim polu (sam styk krawędzią albo w punkcie — nie). */
export function polygonsOverlap(A, B, eps = HD_BLOCK_TUNE.eps) {
  const PA = prepPoly(A), PB = prepPoly(B);
  const E = tolOf([PA, PB], eps);
  if (!boxesTouch(PA.box, PB.box, -E)) return false;
  const E2 = E * E;
  // właściwe przecięcie krawędzi (nie w końcach, nie równoległe)
  for (const [a, b] of PA.edges) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    for (const [c, d] of PB.edges) {
      const fx = d[0] - c[0], fy = d[1] - c[1];
      const den = dx * fy - dy * fx;
      if (Math.abs(den) < 1e-12 * Math.sqrt((dx * dx + dy * dy) * (fx * fx + fy * fy))) continue;
      const t = ((c[0] - a[0]) * fy - (c[1] - a[1]) * fx) / den;
      const u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / den;
      if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) return true;
    }
  }
  // punkt jednego ściśle wewnątrz drugiego: wierzchołki, środki krawędzi, środek ciężkości obrysu
  const strictlyIn = (P, Q, x, y) => {
    if (!insideLoops(Q.loops, x, y)) return false;
    for (const [c, d] of Q.edges) if (segDist2(x, y, c[0], c[1], d[0], d[1]) <= E2 * 16) return false;
    return true;
  };
  for (const [P, Q] of [[PA, PB], [PB, PA]]) {
    for (const [a, b] of P.edges) {
      if (strictlyIn(P, Q, a[0], a[1]) || strictlyIn(P, Q, (a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5)) return true;
    }
    const o = P.loops[0];
    let cx = 0, cy = 0, a2 = 0;
    for (let i = 0, n = o.length; i < n; i++) {
      const p = o[i], q = o[(i + 1) % n], k = p[0] * q[1] - q[0] * p[1];
      a2 += k; cx += (p[0] + q[0]) * k; cy += (p[1] + q[1]) * k;
    }
    if (Math.abs(a2) > 1e-12 && strictlyIn(P, Q, cx / (3 * a2), cy / (3 * a2))) return true;
  }
  return false;
}

/** Odcinki skierowane → pętle (spawanie końców w tolerancji `tol`); obrysy z otworami. */
function stitchSegments(segs, tol) {
  const verts = [];
  const cell = Math.max(tol * 8, 1e-9);
  const hash = new Map();
  const weld = (p) => {
    const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell);
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      const list = hash.get(`${cx + ox},${cy + oy}`);
      if (!list) continue;
      for (const id of list) { const v = verts[id]; if (Math.abs(v[0] - p[0]) <= tol * 4 && Math.abs(v[1] - p[1]) <= tol * 4) return id; }
    }
    const id = verts.length;
    verts.push(p);
    const k = `${cx},${cy}`;
    if (!hash.has(k)) hash.set(k, []);
    hash.get(k).push(id);
    return id;
  };
  const out = new Map();
  const S = [];
  for (const [p, q] of segs) {
    const a = weld(p), b = weld(q);
    if (a === b) continue;
    const id = S.length;
    S.push({ a, b, used: false });
    if (!out.has(a)) out.set(a, []);
    out.get(a).push(id);
  }
  const loops = [];
  for (let s0 = 0; s0 < S.length; s0++) {
    if (S[s0].used) continue;
    const loop = [];
    let s = s0;
    for (let guard = 0; guard <= S.length; guard++) {
      const seg = S[s];
      seg.used = true;
      loop.push(verts[seg.a]);
      if (seg.b === S[s0].a) break;
      // następny odcinek z końca: przy kilku (styk w wierzchołku) — najostrzejszy skręt ku wnętrzu (pętle rozłączne)
      const cand = (out.get(seg.b) || []).filter((k) => !S[k].used);
      if (!cand.length) break;
      let pick = cand[0];
      if (cand.length > 1) {
        const A = verts[seg.a], B = verts[seg.b];
        const ix = B[0] - A[0], iy = B[1] - A[1];
        let best = -Infinity;
        for (const k of cand) {
          const C = verts[S[k].b];
          const ox = C[0] - B[0], oy = C[1] - B[1];
          const ang = Math.atan2(ix * oy - iy * ox, ix * ox + iy * oy);   // > 0 — skręt ku wnętrzu (strona −dy, dx)
          if (ang > best) { best = ang; pick = k; }
        }
      }
      s = pick;
    }
    if (loop.length >= 3) loops.push(simplifyLoop(loop));
  }
  const outer = [], holes = [];
  for (const l of loops) {
    if (l.length < 3) continue;
    const a = loopArea(l);
    if (Math.abs(a) < tol * tol * 100) continue;
    (a > 0 ? outer : holes).push(l);
  }
  const res = outer.map((l) => ({ outer: l, holes: [], area: loopArea(l) })).sort((p, q) => p.area - q.area);
  for (const h of holes) {
    const [hx, hy] = h[0];
    const host = res.find((r) => insideLoops([r.outer], hx, hy));
    if (host) host.holes.push(h);
  }
  return res.map(({ outer: o, holes: hs }) => ({ outer: o, holes: hs }));
}

/** Pętla bez punktów współliniowych i powtórzonych. */
function simplifyLoop(pts) {
  let p = pts;
  for (let pass = 0; pass < 4; pass++) {
    const n = p.length;
    if (n < 3) return p;
    const q = [];
    for (let i = 0; i < n; i++) {
      const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
      const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
      const lu = Math.sqrt(ux * ux + uy * uy), lv = Math.sqrt(vx * vx + vy * vy);
      if (lu < 1e-12) continue;
      if (lv < 1e-12) { q.push(b); continue; }
      if (Math.abs(ux * vy - uy * vx) / (lu * lv) < 1e-9 && ux * vx + uy * vy > 0) continue;
      q.push(b);
    }
    if (q.length === p.length) return q;
    p = q;
  }
  return p;
}

const asLoops = (parts) => parts.flatMap((p) => [p.outer, ...p.holes]);

// ---------------------------------------------------------------------------
// Rozwinięcie klocków projektu

/**
 * Płyta klocka: jego obrys bez pasa `e` [j.] wokół SĄSIEDNICH klocków-płyt (`others` — pętle sąsiadów, które go nie
 * nachodzą). Zwraca [{ outer, holes }] (może być kilka kawałków albo żadnego).
 */
export function blockPlate(loops, others, e) {
  if (!(e > 0) || !others.length) return [{ outer: loops[0], holes: loops.slice(1) }];
  const grown = [];
  for (const q of others) {
    const o = offsetLoop(q[0], -e);
    if (!o) continue;
    const hs = [];
    for (let k = 1; k < q.length; k++) { const h = offsetLoop(q[k], -e); if (h) hs.push(h); }
    grown.push([o, ...hs]);
  }
  if (!grown.length) return [{ outer: loops[0], holes: loops.slice(1) }];
  return polygonDifference(loops, asLoops(polygonUnion(grown)));
}

/**
 * Klocki projektu → bryły 'poly' (rama, płyty poziomów, wycięcia — opis na początku pliku). `opts`: detail [j./jd],
 * mirror(b) — czy klocek ma kopię po drugiej burcie, levels. Bryły mają `mirror: false` (kopie już w sumie) i znacznik
 * `blockSet` ('frame' | 'plate' | 'cut'); płyty — `clip: 0` z `clipIn` (brzeg ramy przy burcie, rimDu jd).
 */
export function expandHullBlocks(blocks, opts = {}) {
  const D = num(opts.detail, 0.6);
  const levels = opts.levels || 4;
  const mirrorOf = opts.mirror || (() => false);
  const T = HD_BLOCK_TUNE;
  // egzemplarze: klocek i jego kopia lustra
  const items = [];
  blocks.forEach((b, i) => {
    const copies = [false];
    if (mirrorOf(b)) copies.push(true);
    for (const m of copies) {
      const loops = blockWorldLoops(b, m);
      items.push({ b, i, loops, poly: prepPoly(loops) });
    }
  });
  const adds = items.filter((it) => it.b.op !== 'cut');
  const cuts = items.filter((it) => it.b.op === 'cut');
  const shapes = [];
  const emit = (parts, base) => {
    for (const p of parts) shapes.push({ kind: 'poly', ...base, pts: p.outer, holes: p.holes.length ? p.holes : undefined, mirror: false });
  };
  if (adds.length) {
    emit(polygonUnion(adds.map((it) => it.loops)), { op: 'add', level: 0, ch: T.frameChDu * D, blockSet: 'frame' });
    // płyty: klocki z poziomem ≥ 1, każda bez pasa pół szczeliny wokół sąsiadów (klocki nachodzące — wspólna płyta)
    const plateItems = adds.filter((it) => it.b.level >= 1);
    for (const it of plateItems) {
      const e = 0.5 * (it.b.gap ?? T.gapDu) * D;
      const nb = [];
      if (e > 0) {
        for (const q of plateItems) {
          if (q === it || !boxesTouch(it.poly.box, q.poly.box, e * 2)) continue;
          if (!polygonsOverlap(it.loops, q.loops)) nb.push(q.loops);
        }
      }
      it.plate = blockPlate(it.loops, nb, e);
    }
    for (let L = 1; L < levels; L++) {
      const polys = [];
      for (const it of plateItems) if (it.b.level >= L) for (const p of it.plate) polys.push([p.outer, ...p.holes]);
      if (polys.length) emit(polygonUnion(polys), { op: 'add', level: L, ch: T.plateChDu * D, clip: 0, clipIn: T.rimDu * D, blockSet: 'plate' });
    }
  }
  if (cuts.length) {
    let prev = '';
    for (let L = 0; L < levels; L++) {
      const set = cuts.filter((it) => it.b.level <= L);
      const key = set.map((it) => items.indexOf(it)).join(',');
      if (!set.length || key === prev) continue;
      prev = key;
      emit(polygonUnion(set.map((it) => it.loops)), { op: 'cut', level: L, ch: 0, blockSet: 'cut' });
    }
  }
  return shapes;
}

/** Klocek z wpisu palety `id` w jednostkach `u` [j.] na (x, y), poziom `level`. */
export function hullBlockFromPalette(id, u, x = 0, y = 0, level = 1) {
  const p = HD_BLOCK_PALETTE.find((q) => q.id === id) || HD_BLOCK_PALETTE[0];
  const b = { kind: 'block', shape: p.shape, x, y, w: p.w * u, h: p.h * u, rot: 0, level, op: 'add' };
  if (p.c) b.c = p.c.map((v) => v * u);
  if (p.a !== undefined) b.a = p.a * u;
  if (p.b !== undefined) b.b = p.b * u;
  if (p.arc) b.arc = p.arc;
  if (p.ri) b.ri = p.ri;
  return b;
}

/** Wpis palety pasujący do klocka (nazwa w edytorze): po kształcie i parametrach. */
export function hullBlockPaletteId(b) {
  if (b.shape === 'rect') return b.c && b.c.some((v) => v > 0) ? 'rect_ch' : 'rect';
  if (b.shape === 'tri') return Math.abs((b.a || 0) - b.w / 2) < 1e-6 * b.w ? 'wedge' : 'tri';
  if (b.shape === 'trap') {
    const a = b.a || 0, bb = b.b || 0;
    if (Math.abs(a + bb) < 1e-6 * b.w && Math.abs(a) > 0) return 'para';
    if (Math.abs(a - bb) < 1e-6 * b.w) return 'trap_i';
    return 'trap_r';
  }
  if (b.ri) return 'ring';
  return b.arc === 90 ? 'quarter' : (b.arc === 180 ? 'half' : 'circle');
}
