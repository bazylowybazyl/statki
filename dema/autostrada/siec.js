// dema/autostrada/siec.js
//
// SIEĆ AUTOSTRADY WOKÓŁ ZIEMI — czysty JS, bez three i DOM. Układ: scena (y w górę), kąty w stopniach CCW,
// gra: x = X, y = −Y, kąt gry = −kąt sceny. Hub miejsca pod kątem a: x wzdłuż ringu (+θ), z promieniowo od R0 = 46 002
// (te same osie co k7Frame). Ścieżka = lista odcinków; próbkowanie daje polilinię (x, y, s, kurs, krzywizna).
//
// Ruch prawostronny: jezdnia WEWNĘTRZNA jedzie CW (θ maleje), planeta i porty po prawej; jezdnia ZEWNĘTRZNA jedzie
// CCW (θ rośnie), przestrzeń po prawej. Zmiana jezdni tylko przez zawrotki w pasie rozdziału; przecina autostradę
// tylko wielkie skrzyżowanie K-7 (4 pasy promieniowe, faza czerwona dla głównej).

export const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
export const R0 = 46002;           // k7Frame(ring).radius — początek huba

/** Przekrój [j.]: promienie środków pasów. Od planety: pobocze / pas wyhamowania, L3, L2, L1, kieszeń, oś, ... */
export const HW = Object.freeze({
  redaOuter: 58502,
  edgeIn: 59500,
  iShoulder: 59700, iL3: 60020, iL2: 60340, iL1: 60740, iPocket: 61140,
  median: 61740,
  oPocket: 62340, oL1: 62740, oL2: 63140, oL3: 63460, oShoulder: 63780,
  edgeOut: 63980,
  widths: Object.freeze({ shoulder: 400, L3: 240, L2: 400, L1: 400, pocket: 400, medianGap: 800 }),
  uturnR: 600
});

/** Prędkości docelowe pasów i ramp [j./s]. */
export const SPEED = Object.freeze({ L1: 1500, L2: 1200, L3: 800, ramp: 400, turn: 350, uturn: 300, hold: 500, spur: 400, box: 900 });

/** Kąty węzłów względem środka kompleksu c (scena) — jeden okres 90°. */
export const NODE = Object.freeze({
  bay: 13.154,
  // Ramy zatoki: wyhamowanie i rozbieg na pasie pobocza (j. od osi zatoki na iShoulder).
  spurX: 600, turnR: 900, decelLen: 1900, accelLen: 2200, taperLen: 1500,
  tSpurX: 280,
  // Wielkie skrzyżowanie K-7: 4 pasy promieniowe i linia stopu.
  boxLanes: Object.freeze([-2430, -810, 810, 2430]),
  boxHalf: 3700, stopX: 4200,
  // Zawrotki: kąt względem c. U1 = zewn. → wewn., U2 = wewn. → zewn.
  u1Bay: 28, u2Bay: -28, u1T: -30.5, u2T: 30.5,
  pocketDecel: 3000, pocketAccel: 3500, pocketTaper: 1200,
  // Wrota z przestrzeni: wlot (na jezdnię zewn.) i wylot (z jezdni zewn.), oś promieniowa, promień końca.
  dIn: 14, dOut: -14, dTurnR: 1200, dLen: 38000,
  // Przedpole ciężkich: drogi współśrodkowe między pasami K-7 a pasami MEGA zatok.
  roadIn: 57400, roadOut: 56400, roadR: 1500, megaX: 2250, heavyWaitZ: 8010, heavyBerthZ: 2100, megaOutSide: 1226
});

export function complexes() { return [45, 135, 225, 315]; }
export function transits() { return [0, 90, 180, 270]; }
export function bays() { return complexes().flatMap((c) => [c - NODE.bay, c + NODE.bay]); }

const polar = (r, aDeg) => ({ x: r * Math.cos(aDeg * DEG), y: r * Math.sin(aDeg * DEG) });

export function hubToWorld(a, x, z) {
  const c = Math.cos(a * DEG); const s = Math.sin(a * DEG);
  const rr = R0 + z;
  return { x: rr * c - x * s, y: rr * s + x * c };
}
export function worldToHub(a, X, Y) {
  const c = Math.cos(a * DEG); const s = Math.sin(a * DEG);
  return { x: -X * s + Y * c, z: X * c + Y * s - R0 };
}

const S5 = (u) => u * u * u * (10 + u * (-15 + 6 * u));

export class Path {
  constructor(id, meta = {}) { this.id = id; Object.assign(this, meta); this.segs = []; }
  arc(r, a0, a1) { this.segs.push({ t: 'arc', r, a0, a1 }); return this; }
  taper(r0, r1, a0, a1) { this.segs.push({ t: 'taper', r0, r1, a0, a1 }); return this; }
  /** Prosta w hubie miejsca a. */
  hubLine(a, x0, z0, x1, z1) { this.segs.push({ t: 'hubLine', a, x0, z0, x1, z1 }); return this; }
  /** Łuk w hubie: środek (cx, cz), promień R, kąt phi w hubie (rad, atan2(z, x)). */
  hubArc(a, cx, cz, R, p0, p1) { this.segs.push({ t: 'hubArc', a, cx, cz, R, p0, p1 }); return this; }
  /** Łuk w scenie: środek (cx, cy), R, kąt (stopnie). */
  circ(cx, cy, R, a0, a1) { this.segs.push({ t: 'circ', cx, cy, R, a0, a1 }); return this; }
}

function segLen(g) {
  switch (g.t) {
    case 'arc': return Math.abs(g.a1 - g.a0) * DEG * g.r;
    case 'taper': { const m = Math.abs(g.a1 - g.a0) * DEG * (g.r0 + g.r1) * 0.5; return Math.hypot(m, Math.abs(g.r1 - g.r0)); }
    case 'hubLine': return Math.hypot(g.x1 - g.x0, g.z1 - g.z0);
    case 'hubArc': return Math.abs(g.p1 - g.p0) * g.R;
    case 'circ': return Math.abs(g.a1 - g.a0) * DEG * g.R;
    default: return 0;
  }
}
function segPt(g, u) {
  switch (g.t) {
    case 'arc': return polar(g.r, g.a0 + (g.a1 - g.a0) * u);
    case 'taper': return polar(g.r0 + (g.r1 - g.r0) * S5(u), g.a0 + (g.a1 - g.a0) * u);
    case 'hubLine': return hubToWorld(g.a, g.x0 + (g.x1 - g.x0) * u, g.z0 + (g.z1 - g.z0) * u);
    case 'hubArc': { const p = g.p0 + (g.p1 - g.p0) * u; return hubToWorld(g.a, g.cx + g.R * Math.cos(p), g.cz + g.R * Math.sin(p)); }
    case 'circ': { const p = (g.a0 + (g.a1 - g.a0) * u) * DEG; return { x: g.cx + g.R * Math.cos(p), y: g.cy + g.R * Math.sin(p) }; }
    default: return null;
  }
}

/** Polilinia ścieżki. */
export function sample(path, step = 60) {
  const xs = []; const ys = [];
  for (const g of path.segs) {
    const L = segLen(g);
    const n = Math.max(2, Math.ceil(L / step));
    for (let i = xs.length ? 1 : 0; i <= n; i++) {
      const p = segPt(g, i / n);
      xs.push(p.x); ys.push(p.y);
    }
  }
  const n = xs.length;
  const s = new Float64Array(n); const k = new Float64Array(n); const h = new Float64Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1); const b = Math.min(n - 1, i + 1);
    h[i] = Math.atan2(ys[b] - ys[a], xs[b] - xs[a]);
  }
  // krzywizna na oknie ~180 j. (odporna na próbkowanie)
  const w = Math.max(1, Math.round(180 / step));
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w); const b = Math.min(n - 1, i + w);
    let d = h[b] - h[a]; d -= TAU * Math.round(d / TAU);
    const ds = s[b] - s[a];
    k[i] = ds > 1e-6 ? Math.abs(d) / ds : 0;
  }
  return { x: Float64Array.from(xs), y: Float64Array.from(ys), s, h, k, n, len: s[n - 1] };
}

// Łuki styczne: prosta x = X w hubie a ↔ okrąg współśrodkowy r (planeta w O = (0, −R0)).
function tangentInside(X, rL, R, side) {  // środek łuku w środku okręgu
  const cx = X + side * R; const dist = rL - R;
  const rz = Math.sqrt(dist * dist - cx * cx);
  return { cx, cz: rz - R0, phi: Math.atan2(rz / dist, cx / dist), delta: Math.atan2(cx, rz) / DEG };
}
function tangentOutside(X, rL, R, side) { // środek na zewnątrz okręgu
  const cx = X + side * R; const dist = rL + R;
  const rz = Math.sqrt(dist * dist - cx * cx);
  return { cx, cz: rz - R0, phi: Math.atan2(-rz / dist, -cx / dist), delta: Math.atan2(cx, rz) / DEG };
}

const lane = (id, r, a0, a1, meta) => new Path(id, { kind: 'main', r, ...meta }).arc(r, a0, a1);

/** Rampa zjazdowa z jezdni wewn. na spur miejsca a (ruch CW: θ maleje; nadjeżdża od +x). */
function spurIn(a, X, zEnd, id, meta = {}) {
  const N = NODE; const h = HW;
  const t = tangentInside(X, h.iShoulder, N.turnR, +1);
  const aT = a + t.delta;                                    // kąt styku z pasem wyhamowania
  const aDecel = aT + (N.decelLen / h.iShoulder) / DEG;
  const aTaper = aDecel + (N.taperLen / h.iL3) / DEG;
  const p = new Path(id, { kind: 'rampOff', site: a, X, ...meta });
  p.taper(h.iL3, h.iShoulder, aTaper, aDecel).arc(h.iShoulder, aDecel, aT);
  // φ rośnie od styku (prawie góra) do π (na prostej x = X)
  p.hubArc(a, t.cx, t.cz, N.turnR, t.phi, Math.PI);
  p.hubLine(a, X, t.cz, X, zEnd);
  p.gore = aTaper; p.tangent = aT;
  return p;
}
/** Rampa wjazdowa ze spuru miejsca a na jezdnię wewn. (w kierunku −x, CW). */
function spurOut(a, X, zStart, id, meta = {}) {
  const N = NODE; const h = HW;
  const t = tangentInside(X, h.iShoulder, N.turnR, -1);
  const aT = a + t.delta;
  const aAccel = aT - (N.accelLen / h.iShoulder) / DEG;
  const aTaper = aAccel - (N.taperLen / h.iL3) / DEG;
  const p = new Path(id, { kind: 'rampOn', site: a, X, ...meta });
  p.hubLine(a, X, zStart, X, t.cz);
  p.hubArc(a, t.cx, t.cz, N.turnR, 0, t.phi);
  p.arc(h.iShoulder, aT, aAccel).taper(h.iShoulder, h.iL3, aAccel, aTaper);
  p.merge = aTaper; p.tangent = aT;
  return p;
}

/** Zawrotka: U1 = z zewnętrznej (CCW) na wewnętrzną (CW) — brzuch w +θ; U2 = wewn. → zewn. — brzuch w −θ. */
function uturn(a, kind, id, meta = {}) {
  const N = NODE; const h = HW;
  const sg = kind === 'U1' ? +1 : -1;         // kierunek jazdy przed zawrotką w θ
  const fromL1 = kind === 'U1' ? h.oL1 : h.iL1;
  const fromP = kind === 'U1' ? h.oPocket : h.iPocket;
  const toP = kind === 'U1' ? h.iPocket : h.oPocket;
  const toL1 = kind === 'U1' ? h.iL1 : h.oL1;
  const dT = (N.pocketTaper / fromL1) / DEG;
  const dD = (N.pocketDecel / fromP) / DEG;
  const dA = (N.pocketAccel / toP) / DEG;
  const dT2 = (N.pocketTaper / toL1) / DEG;
  const p = new Path(id, { kind: 'uturn', uKind: kind, site: a, ...meta });
  p.taper(fromL1, fromP, a - sg * (dD + dT), a - sg * dD);
  p.arc(fromP, a - sg * dD, a);
  // półokrąg R = (fromP − toP)/2 o środku na osi pasa rozdziału
  const c = polar(h.median, a);
  const r = h.uturnR;
  // U1: φ od a przez a+90 (= +θ) do a+180; U2: φ od a+180 przez a+270 (= −θ) do a+360 — oba CCW wokół środka
  p.circ(c.x, c.y, r, kind === 'U1' ? a : a + 180, kind === 'U1' ? a + 180 : a + 360);
  p.arc(toP, a, a - sg * dA);
  p.taper(toP, toL1, a - sg * dA, a - sg * (dA + dT2));
  p.mergeAngle = a - sg * (dA + dT2);
  p.divergeAngle = a - sg * (dD + dT);
  return p;
}

/** Rampa z przestrzeni na jezdnię zewn. i wylot z jezdni zewn. w przestrzeń (oba po prawej). */
function gateIn(a, id, meta = {}) {
  const N = NODE; const h = HW;
  const t = tangentOutside(0, h.oShoulder, N.dTurnR, +1);
  const aT = a + t.delta;
  const aAccel = aT + (N.accelLen / h.oShoulder) / DEG;
  const aTaper = aAccel + (N.taperLen / h.oL3) / DEG;
  const p = new Path(id, { kind: 'gateIn', site: a, ...meta });
  p.hubLine(a, 0, N.dLen, 0, t.cz);
  p.hubArc(a, t.cx, t.cz, N.dTurnR, Math.PI, t.phi < 0 ? t.phi + 2 * Math.PI : t.phi);
  p.arc(h.oShoulder, aT, aAccel).taper(h.oShoulder, h.oL3, aAccel, aTaper);
  p.merge = aTaper;
  return p;
}
function gateOut(a, id, meta = {}) {
  const N = NODE; const h = HW;
  const t = tangentOutside(0, h.oShoulder, N.dTurnR, -1);
  const aT = a + t.delta;
  const aDecel = aT - (N.decelLen / h.oShoulder) / DEG;
  const aTaper = aDecel - (N.taperLen / h.oL3) / DEG;
  const p = new Path(id, { kind: 'gateOut', site: a, ...meta });
  p.taper(h.oL3, h.oShoulder, aTaper, aDecel).arc(h.oShoulder, aDecel, aT);
  p.hubArc(a, t.cx, t.cz, N.dTurnR, t.phi, 0);
  p.hubLine(a, 0, t.cz, 0, N.dLen);
  p.gore = aTaper;
  return p;
}

/** Droga ciężkich: pas K-7 x = +2430 (w dół) → łuk r = roadIn (+θ) → pas MEGA zatoki w hubie a (x = xb, w dół). */
function heavyRoadIn(c, a, xb, id) {
  const N = NODE; const R = N.roadR;
  const t0 = tangentOutside(2430, N.roadIn, R, +1);
  const t1 = tangentInside(xb, N.roadIn, R, -1);
  const a0 = c + t0.delta; const a1 = a + t1.delta;
  const p = new Path(id, { kind: 'heavy', dir: 'in', beamMax: 912, vmax: 350 });
  p.hubLine(c, 2430, 84000 - R0, 2430, t0.cz);
  p.hubArc(c, t0.cx, t0.cz, R, Math.PI, t0.phi < 0 ? t0.phi + 2 * Math.PI : t0.phi);
  p.arc(N.roadIn, a0, a1);
  p.hubArc(a, t1.cx, t1.cz, R, t1.phi, 0);
  p.hubLine(a, xb, t1.cz, xb, N.heavyWaitZ);
  // AGENT: w demie kadłub wchodzi pasem MEGA aż na stanowisko w zatoce.
  p.hubLine(a, xb, N.heavyWaitZ, xb, N.heavyBerthZ);
  return p;
}
/** Wyjazd ciężkich: pas MEGA (x = xb z odbiciem) → łuk r = roadOut (−θ) → pas K-7 x = +810 (w górę). */
function heavyRoadOut(c, a, xb, id, lane) {
  const N = NODE; const R = N.roadR;
  const X = lane === 'i' ? xb - N.megaOutSide : xb + N.megaOutSide;
  const t0 = tangentInside(X, N.roadOut, R, -1);
  const t1 = tangentOutside(810, N.roadOut, R, +1);
  const a0 = a + t0.delta; const a1 = c + t1.delta;
  const p = new Path(id, { kind: 'heavy', dir: 'out', beamMax: 912, vmax: 350 });
  p.hubLine(a, X, N.heavyWaitZ, X, t0.cz);
  p.hubArc(a, t0.cx, t0.cz, R, 0, t0.phi);
  p.arc(N.roadOut, a0, a1);
  p.hubArc(c, t1.cx, t1.cz, R, t1.phi < 0 ? t1.phi + 2 * Math.PI : t1.phi, Math.PI);
  p.hubLine(c, 810, t1.cz, 810, 84000 - R0);
  return p;
}
/** Lustro ścieżki względem osi kompleksu c (strona −): x → −x, kąty a → 2c − a. */
function mirrorPath(p, c, side) {
  if (side > 0) return p;
  p.segs = p.segs.map((g) => {
    if (g.t === 'hubLine') return { ...g, a: 2 * c - g.a, x0: -g.x0, x1: -g.x1 };
    if (g.t === 'hubArc') return { ...g, a: 2 * c - g.a, cx: -g.cx, p0: Math.PI - g.p0, p1: Math.PI - g.p1 };
    if (g.t === 'arc') return { ...g, a0: 2 * c - g.a0, a1: 2 * c - g.a1 };
    return g;
  });
  return p;
}

/** Cała sieć. Zwraca { paths, nodes, signals }. */
export function buildNetwork() {
  const h = HW; const N = NODE; const paths = []; const nodes = []; const signals = [];

  // Główne pasy: jeden łuk 360° na pas.
  const main = [
    ['I.L3', h.iL3, 360, 0, 'in', 240, SPEED.L3], ['I.L2', h.iL2, 360, 0, 'in', 400, SPEED.L2], ['I.L1', h.iL1, 360, 0, 'in', 400, SPEED.L1],
    ['O.L1', h.oL1, 0, 360, 'out', 400, SPEED.L1], ['O.L2', h.oL2, 0, 360, 'out', 400, SPEED.L2], ['O.L3', h.oL3, 0, 360, 'out', 240, SPEED.L3]
  ];
  for (const [id, r, a0, a1, carriageway, width, v] of main) paths.push(lane(id, r, a0, a1, { carriageway, width, vmax: v, beamMax: width - 88 }));

  const spurZEnd = 50352 - R0;   // podejście grzebienia zatoki
  complexes().forEach((c, ci) => {
    const tag = `C${ci}`;
    // Wielkie skrzyżowanie K-7: 4 pasy z hali przez autostradę w przestrzeń.
    const zGate = 7400; const zFar = 84000 - R0;
    for (const x of N.boxLanes) {
      const dirOut = x === -810 || x === 810;
      const p = new Path(`${tag}.BOX${x}`, { kind: 'box', site: c, x, dir: dirOut ? 'out' : 'in', beamMax: 1100, vmax: SPEED.box });
      if (dirOut) p.hubLine(c, x, zGate, x, zFar); else p.hubLine(c, x, zFar, x, zGate);
      paths.push(p);
    }
    signals.push({ id: `${tag}.K7`, node: 'K7', a: c, stopX: N.stopX, phases: ['MAIN', 'YELLOW', 'CLEAR', 'BOX', 'CLEAR2'] });
    nodes.push({ id: `${tag}.K7`, kind: 'k7', a: c });

    // Zatoki: spur IN (x = +600) i OUT (x = −600) po prawej jezdni wewnętrznej.
    for (const [side, a] of [[-1, c - N.bay], [+1, c + N.bay]]) {
      const id = `${tag}.Z${side > 0 ? '+' : '-'}`;
      const off = spurIn(a, +N.spurX, spurZEnd, `${id}.IN`, { beamMax: 500, vmax: SPEED.spur });
      const on = spurOut(a, -N.spurX, spurZEnd, `${id}.OUT`, { beamMax: 500, vmax: SPEED.spur });
      paths.push(off, on);
      nodes.push({ id, kind: 'bay', a, gore: off.gore, merge: on.merge });
    }

    // Drogi przedpola: ciężkie i mega z pasów K-7 do pasów MEGA obu zatok kompleksu (bez wyjazdu na autostradę).
    for (const side of [1, -1]) {
      const a = c + N.bay;   // budowane po stronie +, strona − z lustra względem osi kompleksu
      for (const [lane, xb] of [['i', -N.megaX], ['o', N.megaX]]) {
        paths.push(mirrorPath(heavyRoadIn(c, a, xb, `${tag}.H${side > 0 ? '+' : '-'}${lane}.IN`), c, side));
        paths.push(mirrorPath(heavyRoadOut(c, a, xb, `${tag}.H${side > 0 ? '+' : '-'}${lane}.OUT`, lane), c, side));
      }
    }

    // Wrota z przestrzeni na jezdni zewnętrznej (jedyne wejścia z głębi poza ciężkimi).
    const inA = c + N.dIn; const outA = c + N.dOut;
    const gi = gateIn(inA, `${tag}.D_IN`, { beamMax: 400, vmax: SPEED.ramp });
    const go = gateOut(outA, `${tag}.D_OUT`, { beamMax: 400, vmax: SPEED.ramp });
    paths.push(gi, go);
    nodes.push({ id: `${tag}.D_IN`, kind: 'gateIn', a: inA, merge: gi.merge });
    nodes.push({ id: `${tag}.D_OUT`, kind: 'gateOut', a: outA, gore: go.gore });

    // Zawrotki
    for (const [uk, off, name] of [['U1', N.u1Bay, 'U1'], ['U2', N.u2Bay, 'U2'], ['U1', N.u1T, 'U1T'], ['U2', N.u2T, 'U2T']]) {
      const u = uturn(c + off, uk, `${tag}.${name}`, { beamMax: 400, vmax: SPEED.uturn });
      paths.push(u);
      nodes.push({ id: `${tag}.${name}`, kind: 'uturn', uKind: uk, a: c + off, merge: u.mergeAngle, diverge: u.divergeAngle });
    }
  });

  // Tranzyty: spur IN / OUT ±280 od r ≈ 45 tys. (wylot na habitat, korytarz do Ziemi przez tunel)
  transits().forEach((t, ti) => {
    const id = `T${ti}`;
    const zEnd = 44252 - R0;
    const off = spurIn(t, +N.tSpurX, zEnd, `${id}.IN`, { beamMax: 312, vmax: 260 });
    const on = spurOut(t, -N.tSpurX, zEnd, `${id}.OUT`, { beamMax: 312, vmax: 260 });
    paths.push(off, on);
    nodes.push({ id, kind: 'transit', a: t, gore: off.gore, merge: on.merge });
  });
  return { paths, nodes, signals };
}

/**
 * Sieć gotowa dla ruchu i obrazu: każda ścieżka bez łuku 360° ma próbki (`probki`: x, y, s, h, k, n, len) i profil prędkości
 * `vp` (limit z krzywizny i rodzaju ścieżki, przejście wstecz z hamowaniem); węzły, sygnalizacje, słownik `poId`.
 */
export function zbudujSiec({ krok = 40, aLat = 150, bProfil = 140 } = {}) {
  const net = buildNetwork();
  const poId = new Map();
  for (const p of net.paths) {
    poId.set(p.id, p);
    p.probki = sample(p, p.kind === 'main' ? 200 : krok);
    const q = p.probki;
    const vp = new Float32Array(q.n);
    for (let i = 0; i < q.n; i++) {
      const r = Math.hypot(q.x[i], q.y[i]);
      let lim = limitRodzaju(p, r);
      if (q.k[i] > 1e-5 && p.kind !== 'main') lim = Math.min(lim, Math.sqrt(aLat / q.k[i]));
      vp[i] = lim;
    }
    if (p.kind === 'rampOff' || p.kind === 'heavy') vp[q.n - 1] = 50;
    for (let i = q.n - 2; i >= 0; i--) {
      const ds = q.s[i + 1] - q.s[i];
      vp[i] = Math.min(vp[i], Math.sqrt(vp[i + 1] * vp[i + 1] + 2 * bProfil * ds));
    }
    q.vp = vp;
  }
  net.poId = poId;
  return net;
}

function limitRodzaju(p, r) {
  switch (p.kind) {
    case 'rampOff': case 'rampOn': return r >= HW.edgeIn - 100 ? SPEED.L3 : (p.vmax || SPEED.spur);
    case 'gateIn': case 'gateOut': return r > HW.edgeOut + 1500 ? 1500 : SPEED.L3;
    case 'uturn': return SPEED.L3;
    case 'box': return SPEED.box;
    case 'heavy': return r > HW.edgeIn - 500 ? 600 : 350;
    default: return p.vmax || SPEED.L3;
  }
}

/** Punkt ścieżki w odległości ps wzdłuż niej: { x, y, h, k }; zwraca indeks odcinka (podpowiedź następnego odczytu). */
export function punktNaSciezce(q, ps, out, hint = 0) {
  const s = q.s;
  const n = q.n;
  let i = Math.max(0, Math.min(n - 2, hint | 0));
  if (ps <= 0) i = 0;
  else if (ps >= q.len) i = n - 2;
  else {
    while (i < n - 2 && s[i + 1] < ps) i++;
    while (i > 0 && s[i] > ps) i--;
  }
  const d = s[i + 1] - s[i];
  const u = d > 1e-6 ? (ps - s[i]) / d : 0;
  out.x = q.x[i] + (q.x[i + 1] - q.x[i]) * u;
  out.y = q.y[i] + (q.y[i + 1] - q.y[i]) * u;
  let dh = q.h[i + 1] - q.h[i];
  if (dh > Math.PI) dh -= 2 * Math.PI; else if (dh < -Math.PI) dh += 2 * Math.PI;
  out.h = q.h[i] + dh * u;
  out.k = q.k[i];
  return i;
}
