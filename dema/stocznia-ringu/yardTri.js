// Stocznia Ziemi „zamknięta” (szkic użytkownika 2026-11-12, trzecia wersja): od drogi ringu odchodzi w głąb stoczni
// ULICA dwupasmowa z kratownicą (taka sama jak droga przy ringu), obiega TRÓJKĄTNY SUCHY DOK, w którym powstają
// statki, a z zewnątrz zamykają ją budowle — do stoczni wlatuje się tylko od środka (z drogi ringu), nie z przestrzeni.
// Bez taśm: surowce przywożą statki ulicą. Kratownica pod ulicą wozi gotowe kadłuby: kadłub wyjeżdża z pochylni na
// kratownicę i jedzie nią do doków.
//
// Czysta geometria w układzie stoczni (a — od lica hali w przestrzeń, c — w poprzek); `at(a, c)` przelicza na układ
// lokalny kompleksu (x, z). Bez three i DOM.

export const YARD_TRI = Object.freeze({
  streetW: 2600,        // ulica: dwa pasy jak droga przy ringu
  rowT: 1200,           // budowle zamykające ulicę od zewnątrz (z dokami otwartymi na ulicę)
  stemLen: 3600,        // odcinek ulicy od lica hali do obwodnicy doku
  Rc: 3600,             // promień okręgu opisanego na trójkącie doku
  hubR: 850,            // węzły w narożach doku
  centerR: 1100,        // węzeł środkowy
  slipD: 2100,          // głębokość pasa pochylni (od boku trójkąta ku ulicy)
  slipGap: 150,         // koniec pochylni → krawędź ulicy
  fingerW: 110,         // pomosty między pochylniami (z żurawiem)
  speed: 200,           // prędkość wózka na kratownicy [j./s] — jedna dla wszystkich (bez wyprzedzania)
  supplyOff: 820,       // tor statków dostaw: odległość od osi ulicy (mija kadłub capital na kratownicy)
  supplySpeed: 320,     // prędkość statków dostaw na ulicy [j./s]
  // pochylnie na bokach: A — bok daleki (od strony przestrzeni), B i C — boki od strony hali
  sides: Object.freeze([
    Object.freeze({ key: 'A', slips: Object.freeze(['capital', 'capital', 'capital']) }),
    Object.freeze({ key: 'B', slips: Object.freeze(['carrier', 'l', 'l', 'l', 'l']) }),
    Object.freeze({ key: 'C', slips: Object.freeze(['m', 'm', 'm', 's', 's', 's', 's']) })
  ]),
  // szerokość pochylni, długość zajmowana przez kadłub, czas budowy [s przy tempie ×1], drony, kadłuby na zmianę
  slip: Object.freeze({
    capital: Object.freeze({ w: 1150, len: 1950, build: 220, drones: 8, hulls: ['heavy_freighter'] }),
    carrier: Object.freeze({ w: 820, len: 1300, build: 150, drones: 6, hulls: ['terran_carrier'] }),
    l: Object.freeze({ w: 700, len: 800, build: 100, drones: 4, hulls: ['terran_battleship', 'long_haul_freighter', 'tanker'] }),
    m: Object.freeze({ w: 540, len: 480, build: 70, drones: 3, hulls: ['terran_destroyer', 'container_ship', 'heavy_harvester'] }),
    s: Object.freeze({ w: 380, len: 300, build: 50, drones: 2, hulls: ['terran_frigate', 'inter_station_shuttle', 'police_cutter', 'belter'] })
  }),
  stemRow: Object.freeze(['m', 'l', 'm']),                 // doki w budowlach przy odcinku ulicy od hali
  wallRow: Object.freeze(['l', 'm', 'l', 'm', 'l'])        // doki dostaw w budowlach przy bokach obwodnicy
});

const TAU = Math.PI * 2;

/** Odległość punktu od wypukłego wielokąta (0 w środku). */
export function distToConvex(points, x, z) {
  let inside = true;
  let sign = 0;
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const cr = ex * (z - a[1]) - ez * (x - a[0]);
    if (Math.abs(cr) > 1e-9) {
      const s = cr > 0 ? 1 : -1;
      if (sign === 0) sign = s; else if (s !== sign) inside = false;
    }
    const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez || 1)));
    const dx = x - a[0] - ex * t;
    const dz = z - a[1] - ez * t;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < best) best = d;
  }
  return inside ? 0 : best;
}

/**
 * Łamana z zaokrąglonymi narożami (promień r) tam, gdzie skręt przekracza ~20°. Punkty styczności leżą w odległości
 * r · tg(skręt / 2) od naroża LICZONEJ PO ŁAMANEJ (łamana bywa gęsta — odcinki po 160 j.), punkty między nimi wypadają.
 */
export function roundCorners(pts, r = 600) {
  const n = pts.length;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const sharp = [];
  for (let i = 1; i + 1 < n; i++) {
    const ux = pts[i][0] - pts[i - 1][0];
    const uz = pts[i][1] - pts[i - 1][1];
    const vx = pts[i + 1][0] - pts[i][0];
    const vz = pts[i + 1][1] - pts[i][1];
    const lu = Math.hypot(ux, uz);
    const lv = Math.hypot(vx, vz);
    if (lu < 1e-6 || lv < 1e-6) continue;
    const turn = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uz * vz) / (lu * lv))));
    if (turn >= 0.35) sharp.push({ i, turn });
  }
  if (!sharp.length) return pts.slice();
  const pointAt = (d) => {
    let k = 0;
    while (k + 2 < n && cum[k + 1] < d) k++;
    const t = (d - cum[k]) / (cum[k + 1] - cum[k] || 1);
    return [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t];
  };
  const out = [];
  let idx = 0;
  for (let k = 0; k < sharp.length; k++) {
    const { i, turn } = sharp[k];
    const prev = k > 0 ? cum[sharp[k - 1].i] : 0;
    const next = k + 1 < sharp.length ? cum[sharp[k + 1].i] : cum[n - 1];
    const d = Math.min(r * Math.tan(Math.min(turn / 2, 1.2)), (cum[i] - prev) * 0.45, (next - cum[i]) * 0.45);
    const a = cum[i] - d;
    const b = cum[i] + d;
    while (idx < n && cum[idx] < a - 1e-6) out.push(pts[idx++]);
    const p0 = pointAt(a);
    const p2 = pointAt(b);
    const B = pts[i];
    for (let q = 0; q <= 10; q++) {
      const t = q / 10;
      const w0 = (1 - t) * (1 - t);
      const w1 = 2 * t * (1 - t);
      const w2 = t * t;
      out.push([p0[0] * w0 + B[0] * w1 + p2[0] * w2, p0[1] * w0 + B[1] * w1 + p2[1] * w2]);
    }
    while (idx < n && cum[idx] <= b + 1e-6) idx++;
  }
  while (idx < n) out.push(pts[idx++]);
  return out;
}

/** Próbnik łamanej po długości: `at(d, out)` → out.x, out.z, out.h (kurs). */
export function pathSampler(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const len = cum[cum.length - 1];
  let hint = 0;
  return {
    pts, len,
    at(d, out = {}) {
      const x = Math.max(0, Math.min(len, d));
      if (cum[hint] > x) hint = 0;
      while (hint + 2 < cum.length && cum[hint + 1] < x) hint++;
      const a = pts[hint];
      const b = pts[hint + 1];
      const seg = cum[hint + 1] - cum[hint] || 1;
      const t = (x - cum[hint]) / seg;
      out.x = a[0] + (b[0] - a[0]) * t;
      out.z = a[1] + (b[1] - a[1]) * t;
      out.h = Math.atan2(b[1] - a[1], b[0] - a[0]);
      return out;
    }
  };
}

/**
 * Buduje stocznię. `ctx`: at(a, c) → [x, z] (układ kompleksu), PITS / BERTH (tabele doków i pól), addSolid(id, tag,
 * zone, points), berths (lista stanowisk kompleksu — dopisywane doki ulicy), aRoad (a osi drogi ringu, ujemne),
 * roadPts (punkty osi drogi ringu od skrzyżowania ku portowi, układ kompleksu), roadPoint(d, off) → punkt drogi
 * ringu w odległości d od skrzyżowania (+ ku portowi) i off od osi (+ ku przestrzeni).
 */
export function buildYardTri(ctx) {
  const T = YARD_TRI;
  const { at, PITS, BERTH, addSolid, berths } = ctx;
  const zone = 'YT';
  const hwS = T.streetW / 2;
  const Din = T.slipD + T.slipGap;          // krawędź ulicy od strony doku (odległość od boku trójkąta)
  const Dc = Din + hwS;                     // oś ulicy = kratownica
  const Dout = Din + T.streetW;             // krawędź ulicy od strony budowli zamykających
  const Dwall = Dout + T.rowT;              // lico zewnętrzne stoczni
  const apexA = T.stemLen + Dout;           // naroże trójkąta od strony hali
  const ca = apexA + T.Rc;                  // środek doku
  const h = (T.Rc * Math.sqrt(3)) / 2;
  const verts = [[ca - T.Rc, 0], [ca + T.Rc / 2, h], [ca + T.Rc / 2, -h]];
  const O = at(0, 0);
  const A1 = at(1, 0);
  const C1 = at(0, 1);
  const dirXZ = (na, nc) => [(A1[0] - O[0]) * na + (C1[0] - O[0]) * nc, (A1[1] - O[1]) * na + (C1[1] - O[1]) * nc];
  const X = (p) => at(p[0], p[1]);
  const pits = [];
  const pieces = [];
  const counters = {};

  // boki: C (naroże 0 → 1, strona +c), A (1 → 2, bok daleki), B (2 → 0, strona −c); normalna na zewnątrz doku
  const sideDefs = [['C', 0, 1], ['A', 1, 2], ['B', 2, 0]];
  const sides = sideDefs.map(([key, i, j]) => {
    const P = verts[i];
    const Q = verts[j];
    const len = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
    const t = [(Q[0] - P[0]) / len, (Q[1] - P[1]) / len];
    const mx = (P[0] + Q[0]) / 2 - ca;
    const mc = (P[1] + Q[1]) / 2;
    const ml = Math.hypot(mx, mc);
    return { key, i, j, P, Q, len, t, n: [mx / ml, mc / ml], def: T.sides.find((s) => s.key === key) };
  });
  const sideByKey = Object.fromEntries(sides.map((s) => [s.key, s]));

  // --- dok: trójkąt, węzły w narożach i w środku
  addSolid('DOK TRÓJKĄTNY', 'core', zone, verts.map(X));
  const hubs = verts.map((v, i) => ({ a: v[0], c: v[1], r: T.hubR, corner: i })).concat([{ a: ca, c: 0, r: T.centerR, corner: -1 }]);
  for (const hb of hubs) {
    const poly = [];
    for (let k = 0; k < 12; k++) poly.push(at(hb.a + Math.cos((k / 12) * TAU) * hb.r, hb.c + Math.sin((k / 12) * TAU) * hb.r));
    addSolid('WĘZEŁ DOKU', 'hub', zone, poly);
  }

  // --- pochylnie na bokach: kadłub między pomostami, dziobem ku ulicy; żuraw na pomoście
  const slips = [];
  for (const sd of sides) {
    const u0 = T.hubR + 60;
    const u1 = sd.len - T.hubR - 60;
    const base = (u) => [sd.P[0] + sd.t[0] * u, sd.P[1] + sd.t[1] * u];
    const off = (p, d) => [p[0] + sd.n[0] * d, p[1] + sd.n[1] * d];
    addSolid(`POCHYLNIE ${sd.key}`, 'buildstrip', zone, [base(u0), base(u1), off(base(u1), T.slipD), off(base(u0), T.slipD)].map(X));
    let wsum = 0;
    for (const cls of sd.def.slips) wsum += T.slip[cls].w;
    const gap = (u1 - u0 - wsum) / (sd.def.slips.length + 1);
    // Pas pochylni ma stałą głębokość (ulica to krzywa równoległa do doku), a kadłuby boku bywają krótkie: stoją
    // przy ulicy (krótki wyjazd na kratownicę), a między nimi a bokiem doku jest POKŁAD WARSZTATÓW (`back`).
    let maxLen = 0;
    for (const cls of sd.def.slips) maxLen = Math.max(maxLen, T.slip[cls].len);
    const back = Math.max(0, T.slipD - (maxLen + 260));
    sd.u0 = u0;
    sd.u1 = u1;
    sd.gap = gap;
    sd.back = back;
    sd.fingers = [];
    let cur = u0 + gap;
    sd.def.slips.forEach((cls, k) => {
      const def = T.slip[cls];
      const uc = cur + def.w / 2;
      const depth = back + def.len / 2 + 110;          // środek kadłuba od boku trójkąta
      const cl = off(base(uc), depth);
      const [cx, cz] = X(cl);
      const [ax, az] = dirXZ(sd.n[0], sd.n[1]);
      const fingerLen = Math.min(T.slipD - back, def.len + 150);
      // pomost po lewej stronie pochylni (od strony początku boku); ostatnia pochylnia dostaje też prawy
      sd.fingers.push({ u: cur - gap / 2, len: fingerLen, d0: back });
      const exit = off(base(uc), Dc);
      const crU = cur - gap / 2;
      const craneDepth = Math.min(fingerLen * 0.55, def.len / 2 + 110);    // od początku pomostu
      const crane = off(base(crU), back + craneDepth);
      const [px, pz] = X(crane);
      const [hx, hz] = dirXZ(sd.t[0], sd.t[1]);          // wysięgnik: wzdłuż boku nad kadłub
      const reach = gap / 2 + def.w / 2;
      // skład części, nad który wraca wysięgnik (obrót o 90°): dalej na pomoście, a gdy się nie mieści — bliżej
      // doku (pokład warsztatów albo wierzch doku)
      const pickOut = craneDepth + reach <= fingerLen - 40;
      const pickD = back + craneDepth + (pickOut ? reach : -reach);
      const [pickX, pickZ] = X(off(base(crU), pickD));
      const slip = {
        id: `${sd.key}${k + 1}`, index: slips.length, side: sd.key, cls, def, k, w: def.w, uc, depth, fingerLen,
        cx, cz, ax, az, heading: Math.atan2(az, ax), exit,
        at: (al, ac) => [cx + ax * al + az * ac, cz + az * al - ax * ac],
        crane: {
          index: slips.length, px, pz, hx, hz, reach, big: cls === 'capital' || cls === 'carrier', cls,
          depth: back + craneDepth, pickD, pickX, pickZ,
          // obrót wysięgnika wokół osi pionowej o +90° daje kierunek (hz, −hx); znak tak, żeby trafić nad skład
          pickSign: (hz * ax - hx * az > 0 ? 1 : -1) * (pickOut ? 1 : -1), pickOut
        }
      };
      slips.push(slip);
      cur += def.w + gap;
    });
    const lastLen = Math.min(T.slipD - back, T.slip[sd.def.slips[sd.def.slips.length - 1]].len + 150);
    sd.fingers.push({ u: cur - gap / 2, len: lastLen, d0: back });
  }

  // --- budowle zamykające: belka prosta z dokami otwartymi na ulicę (linia bazowa = krawędź ulicy)
  function nextId(kind) {
    counters[kind] = (counters[kind] || 0) + 1;
    return `${zone}-${kind.toUpperCase()}${counters[kind]}`;
  }
  /** P — początek krawędzi ulicy, t — kierunek wzdłuż, len, nIn — w głąb budowli (od ulicy), thick, row. */
  function lineBar({ id, P, t, len, nIn, thick, row }) {
    const pt = (u, w) => [P[0] + t[0] * u + nIn[0] * w, P[1] + t[1] * u + nIn[1] * w];
    let wsum = 0;
    for (const cls of row) wsum += PITS[cls].w;
    const wall = (len - wsum) / (row.length + 1);
    const cuts = [];
    let cur = wall;
    for (const cls of row) {
      const Pd = PITS[cls];
      const C = BERTH[cls];
      const u0 = cur;
      const u1 = cur + Pd.w;
      const mouth = pt((u0 + u1) / 2, 0);
      const bw = Pd.d - 80 - C.length / 2;
      const bc = pt((u0 + u1) / 2, bw);
      const [bx, bz] = X(bc);
      const [ix, iz] = dirXZ(nIn[0], nIn[1]);
      const [ux, uz] = dirXZ(t[0], t[1]);
      const [mx, mz] = X(mouth);
      const pid = nextId(cls);
      const berth = { id: pid, cls, kind: cls, zone, navy: false, yard: true, x: bx, z: bz, heading: Math.atan2(iz, ix), length: C.length, width: C.width, s: bx, v: bz };
      const pit = {
        id: pid, kind: cls, cls, zone, orient: 'xz', yard: true, w: Pd.w, d: Pd.d, berth,
        poly: [pt(u0, 0), pt(u1, 0), pt(u1, Pd.d), pt(u0, Pd.d)].map(X),
        frame: { ox: mx, oz: mz, ux, uz, wx: ix, wz: iz }
      };
      pits.push(pit);
      berths.push(berth);
      cuts.push({ a: u0, b: u1, pit });
      cur += Pd.w + wall;
    }
    const marks = [0, len];
    for (const c of cuts) marks.push(c.a, c.b);
    marks.sort((p, q) => p - q);
    for (let i = 0; i + 1 < marks.length; i++) {
      const p = marks[i];
      const q = marks[i + 1];
      if (q - p < 0.5) continue;
      const cut = cuts.find((c) => c.a <= p + 0.25 && c.b >= q - 0.25) || null;
      const n = Math.max(1, Math.ceil((q - p) / 900));
      for (let k = 0; k < n; k++) {
        const a0 = p + ((q - p) * k) / n;
        const a1 = p + ((q - p) * (k + 1)) / n;
        const w0 = cut ? cut.pit.d : 0;
        const poly = [pt(a0, w0), pt(a1, w0), pt(a1, thick), pt(a0, thick)].map(X);
        const [ix, iz] = dirXZ(nIn[0], nIn[1]);
        pieces.push({ id, poly, pit: cut ? cut.pit : null, e0: X(pt(a0, 0)), e1: X(pt(a1, 0)), ix, iz, w0, thick });
        addSolid(id, cut ? 'pit-back' : 'wall', zone, poly);
      }
    }
  }
  // odcinek od hali: budowle po obu stronach ulicy do łuku obwodnicy. Belka z dokami kończy się tam, gdzie zaczyna
  // się lico zewnętrzne łuku (stemBar); resztę do krawędzi ulicy domyka klin (bez doków — nie wchodzi w łuk).
  const thetaO = Math.asin(hwS / Dout);
  const stemEnd = apexA - Math.sqrt(Dout * Dout - hwS * hwS);
  const stemBar = apexA - Dwall * Math.cos(thetaO);
  const wedgeC = Dwall * Math.sin(thetaO);
  const wedges = [];
  for (const sgn of [-1, 1]) {
    lineBar({ id: `ULICA ${sgn > 0 ? 'P' : 'L'}`, P: [0, sgn * hwS], t: [1, 0], len: stemBar, nIn: [0, sgn], thick: T.rowT, row: T.stemRow });
    const poly = [[stemBar, sgn * hwS], [stemEnd, sgn * hwS], [stemBar, sgn * wedgeC]].map(X);
    wedges.push({ poly, sgn, e0: X([stemBar, sgn * hwS]), e1: X([stemEnd, sgn * hwS]) });
    addSolid(`KLIN ${sgn > 0 ? 'P' : 'L'}`, 'wall', zone, poly);
  }
  // boki obwodnicy: budowle równoległe do boków doku
  for (const sd of sides) {
    lineBar({ id: `ŚCIANA ${sd.key}`, P: [sd.P[0] + sd.n[0] * Dout, sd.P[1] + sd.n[1] * Dout], t: sd.t, len: sd.len, nIn: sd.n, thick: T.rowT, row: T.wallRow });
  }
  // łuki obwodnicy wokół naroży; przy narożu od strony hali przerwa na wlot ulicy
  const arcs = [];
  const arcBar = (v, a0, a1, tag) => {
    const n = Math.max(1, Math.ceil((Math.abs(a1 - a0) * Dwall) / 850));
    for (let k = 0; k < n; k++) {
      const t0 = a0 + ((a1 - a0) * k) / n;
      const t1 = a0 + ((a1 - a0) * (k + 1)) / n;
      const p = (ang, r) => [v[0] + Math.cos(ang) * r, v[1] + Math.sin(ang) * r];
      const poly = [p(t0, Dout), p(t1, Dout), p(t1, Dwall), p(t0, Dwall)].map(X);
      arcs.push({ poly, v, t0, t1, e0: X(p(t0, Dout)), e1: X(p(t1, Dout)), o0: X(p(t0, Dwall)), o1: X(p(t1, Dwall)) });
      addSolid(`ŁUK ${tag}`, 'wall', zone, poly);
    }
  };
  // naroże 1 (+c): od normalnej boku C (120°) do normalnej boku A (0°); naroże 2 (−c): od 0° do −120°
  arcBar(verts[1], (2 * Math.PI) / 3, 0, '1');
  arcBar(verts[2], 0, -(2 * Math.PI) / 3, '2');
  // naroże 0 (od hali): 120° … 240° z przerwą ±thetaO wokół 180°
  arcBar(verts[0], (2 * Math.PI) / 3, Math.PI - thetaO, '0P');
  arcBar(verts[0], Math.PI + thetaO, (4 * Math.PI) / 3, '0L');

  // --- oś ulicy (kratownica): obwodnica — krzywa równoległa do trójkąta w odległości Dc, zamknięta, od skrzyżowania
  const loop = [];
  const pushArc = (v, a0, a1) => {
    const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 0.12));
    for (let k = 0; k <= n; k++) {
      const ang = a0 + ((a1 - a0) * k) / n;
      loop.push([v[0] + Math.cos(ang) * Dc, v[1] + Math.sin(ang) * Dc]);
    }
  };
  const pushLine = (P, Q, n) => {
    const len = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
    const m = Math.max(1, Math.round(len / 160));
    for (let k = 1; k < m; k++) loop.push([P[0] + ((Q[0] - P[0]) * k) / m + n[0] * Dc, P[1] + ((Q[1] - P[1]) * k) / m + n[1] * Dc]);
  };
  // od skrzyżowania (180° przy narożu 0) ku stronie +c: łuk, bok C, łuk naroża 1, bok A, łuk naroża 2, bok B, łuk do 180°
  pushArc(verts[0], Math.PI, (2 * Math.PI) / 3);
  pushLine(verts[0], verts[1], sideByKey.C.n);
  pushArc(verts[1], (2 * Math.PI) / 3, 0);
  pushLine(verts[1], verts[2], sideByKey.A.n);
  pushArc(verts[2], 0, -(2 * Math.PI) / 3);
  pushLine(verts[2], verts[0], sideByKey.B.n);
  pushArc(verts[0], (4 * Math.PI) / 3, Math.PI);
  const junction = [apexA - Dc, 0];
  const stemAxis = [];
  for (let a = junction[0]; a > ctx.aRoad; a -= 160) stemAxis.push([a, 0]);
  stemAxis.push([ctx.aRoad, 0]);

  // --- trasy kadłubów po kratownicy: pochylnia → oś obwodnicy → skrzyżowanie → odcinek do drogi ringu → droga ku portowi.
  // Bok C i A jadą obwodnicą „wstecz” (ku +c stronie skrzyżowania), bok B „naprzód” — bez ruchu z naprzeciwka.
  const nearest = (p) => {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < loop.length; i++) {
      const d = (loop[i][0] - p[0]) ** 2 + (loop[i][1] - p[1]) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  };
  for (const s of slips) {
    const i0 = nearest(s.exit);
    const raw = [];
    const sd = sideByKey[s.side];
    const center = [sd.P[0] + sd.t[0] * s.uc + sd.n[0] * s.depth, sd.P[1] + sd.t[1] * s.uc + sd.n[1] * s.depth];
    raw.push(center);
    raw.push(s.exit);
    if (s.side === 'B') for (let i = i0 + 1; i < loop.length; i++) raw.push(loop[i]);
    else for (let i = i0 - 1; i >= 0; i--) raw.push(loop[i]);
    const toJ = raw.length;
    for (let i = 1; i < stemAxis.length; i++) raw.push(stemAxis[i]);
    const local = raw.map(X).concat(ctx.roadPts);
    const pts = roundCorners(local, 650);
    s.route = pathSampler(pts);
    // droga do skrzyżowania (do kolejności wjazdu na wspólny odcinek)
    let dJ = 0;
    for (let i = 1; i < toJ; i++) dJ += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
    s.toJunction = dJ;
  }

  // --- trasa statków dostaw (bez taśm — surowce przywożą statki): droga ringu pasem przy ringu (ku −s) → w lewo
  // w ulicę stoczni → pas zewnętrzny obwodnicy dookoła doku (bok B → A → C) → ulica → droga ringu ku portowi (+s)
  const so = T.supplyOff;
  const Ro = Dc + so;
  const aJoin = apexA - Math.sqrt(Ro * Ro - so * so);
  const th = Math.asin(so / Ro);
  const lane = [];
  const laneArc = (v, a0, a1) => {
    const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 0.1));
    for (let k = 0; k <= n; k++) { const ang = a0 + ((a1 - a0) * k) / n; lane.push([v[0] + Math.cos(ang) * Ro, v[1] + Math.sin(ang) * Ro]); }
  };
  const laneLine = (P, Q, n) => {
    const m = Math.max(1, Math.round(Math.hypot(Q[0] - P[0], Q[1] - P[1]) / 300));
    for (let k = 1; k < m; k++) lane.push([P[0] + ((Q[0] - P[0]) * k) / m + n[0] * Ro, P[1] + ((Q[1] - P[1]) * k) / m + n[1] * Ro]);
  };
  lane.push([ctx.aRoad - so, -so]);
  for (let a = ctx.aRoad + 400; a < aJoin - 200; a += 300) lane.push([a, -so]);
  laneArc(verts[0], Math.PI + th, (4 * Math.PI) / 3);
  laneLine(verts[0], verts[2], sideByKey.B.n);
  laneArc(verts[2], (4 * Math.PI) / 3, 2 * Math.PI);
  laneLine(verts[2], verts[1], sideByKey.A.n);
  laneArc(verts[1], 0, (2 * Math.PI) / 3);
  laneLine(verts[1], verts[0], sideByKey.C.n);
  laneArc(verts[0], (2 * Math.PI) / 3, Math.PI - th);
  for (let a = aJoin - 250; a > ctx.aRoad + so + 400; a -= 300) lane.push([a, so]);
  lane.push([ctx.aRoad + so, so]);
  const supplyPts = [];
  for (let d = 7000; d >= 900; d -= 300) supplyPts.push(ctx.roadPoint(d, -so));
  for (const p of lane) supplyPts.push(X(p));
  for (let d = 900; d <= 7000; d += 300) supplyPts.push(ctx.roadPoint(d, so));
  const supply = pathSampler(roundCorners(supplyPts, 650));

  const outline = (d) => {
    // obwiednia w odległości d od trójkąta (do kadrów i testów): naroża po łuku co 15°
    const pts = [];
    const corner = (v, a0, a1) => { for (let k = 0; k <= 8; k++) { const ang = a0 + ((a1 - a0) * k) / 8; pts.push([v[0] + Math.cos(ang) * d, v[1] + Math.sin(ang) * d]); } };
    corner(verts[0], (4 * Math.PI) / 3, (2 * Math.PI) / 3);
    corner(verts[1], (2 * Math.PI) / 3, 0);
    corner(verts[2], 0, -(2 * Math.PI) / 3);
    return pts;
  };
  const core = verts.map((v) => [v[0], v[1]]);
  return {
    zone, at, verts, sides, hubs, slips, pits, pieces, arcs, wedges, loop, stemAxis, junction, outline, core, supply,
    Din, Dc, Dout, Dwall, apexA, ca, stemEnd, stemBar, hwS, thetaO, far: ca + T.Rc / 2 + Dwall, halfWidth: h + Dwall,
    /** Odległość punktu (a, c) od trójkąta doku. */
    dist: (a, c) => distToConvex(core, a, c)
  };
}
