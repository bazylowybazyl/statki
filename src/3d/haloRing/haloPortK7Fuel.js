// src/3d/haloRing/haloPortK7Fuel.js
//
// OBSŁUGA PALIWOWA STANOWISK CAPITAL K-7 (2026-10-07) — ramię SCARA i przewód paliwowy z fizyką liny. Część CZYSTA
// (bez three, DOM i Core3D — testy node), wspólna dla renderu hali (haloPortK7.js: człony ramion, wysięgnik, rura
// przewodu, złączka) i źródeł gazu hali (gasField/hallGasSources.js: para tam, gdzie ramię niesie złączkę).
//
// Prośba użytkownika: przewody „chodzą twardo i nierealistycznie” (dawniej krzywa Béziera, której koniec jechał po
// prostej od słupka do wlewu), suwnice „nie mają żadnej roli” — złączkę niesie teraz robot na słupku paliwowym:
//  • RAMIĘ SCARA: bark i łokieć obracane w poziomie, pionowy wysięgnik. Poza `extension` prowadzi kąty przegubów od
//    złożenia do ustawienia nad wlewem (interpolacja w przestrzeni przegubów — końcówka idzie łukiem jak w prawdziwym
//    robocie), `seat` — wysięgnik opuszcza złączkę na wlew. Przeguby i wysięgnik nadążają za pozą jak napęd z masą
//    (sprężyna z tłumieniem — lekkie przeregulowanie i wybrzmienie na końcu ruchu);
//  • ZŁĄCZKA wisi na linie przegubu pod wysięgnikiem (wahadło), przy ryglowaniu wchodzi na wlew (naprowadzanie)
//    i siedzi na nim; odryglowanie daje odrzut (rozprężenie) — złączka podskakuje, przewód się kołysze;
//  • PRZEWÓD — lina Verleta z ograniczeniami odległości (PBD) i sztywnością na zginanie: grawitacja ku pokładowi,
//    opór powietrza hali, tarcie, zderzenia z pokładem, słupkiem i KADŁUBEM statku (obrys w hubie — przewód kładzie
//    się na grzbiecie, spływa przez burtę, odjeżdżający kadłub go ciągnie). BĘBEN wydaje i zwija przewód: ogniwa
//    mają stałą długość, zmienia się ogniwo przy bębnie (węzły rodzą się i znikają w wylocie — żebra przewodu
//    wyjeżdżają z bębna).
// Czas: dt gry (pauza = 0 — przewód stoi), stały podkrok; przewód usypia, gdy nic się nie rusza. Bez alokacji na krok.
// Układ: hub hali (x, z), wysokość y = wysokość K-7 (pokład 0, spód kadłuba 48, szczyt kadłuba = płaszczyzna lotu 116).
import { K7_FUEL_STATION, K7_HEIGHTS, k7AngleDelta } from './haloPortK7Layout.js';

/** Strojenie (na żywo: window.K7FuelTune w demie i w grze z ?dev). Długości [j.], czasy [s], przyspieszenia [j/s²]. */
export const K7_FUEL_TUNE = {
  gravity: 1500,        // ku pokładowi (pendulum przewodu ~500 j. ≈ 3,6 s — ciężki, duży przewód)
  drag: 0.75,           // opór powietrza hali dla przewodu [1/s]
  couplerDrag: 1.6,     // opór złączki [1/s]
  iterations: 18,       // przebiegi ograniczeń na podkrok
  bend: 0.05,           // sztywność na zginanie: wygładzenie węzła ku środkowi sąsiadów na PODKROK (rozłożone na przebiegi)
  friction: 0.06,       // tarcie o pokład i kadłub (ułamek prędkości poziomej na podkrok)
  substep: 1 / 240,
  maxSubsteps: 12,
  slack: 1.07,          // bęben: długość przewodu = odległość wylot → złączka × slack + sag
  sag: 48,
  reelRate: 560,        // najszybsze wydawanie / zwijanie [j/s]
  reelTau: 0.2,         // nadążanie bębna [s]
  minLength: 70,
  jointOmega: 7.5,      // napęd przegubów ramienia [rad/s] i tłumienie (< 1 — lekkie przeregulowanie)
  jointZeta: 0.58,
  quillOmega: 10,       // napęd wysięgnika
  quillZeta: 0.72,
  wristStiff: 0.035,    // przegub złączki: powrót pod wysięgnik (na przebieg)
  couplerMass: 9,       // złączka względem węzła przewodu
  latchSnap: 16,        // ryglowanie, gdy złączka bliżej wlewu niż tyle [j.]
  guide: 70,            // naprowadzanie złączki na wlew przy ryglowaniu (zasięg [j.])
  unlatchKick: 240,     // odrzut złączki przy odryglowaniu [j/s] (w górę + na zewnątrz)
  sleepSpeed: 1.5,      // przewód usypia, gdy najszybszy węzeł wolniejszy niż tyle [j/s] (resztki solvera ~0,3) …
  sleepAfter: 1.0       // … przez tyle sekund
};

/** Węzłów przewodu najwyżej (ogniwo 14 j. → do ~990 j. przewodu). */
export const K7_HOSE_NODES = 72;
/** Długość ogniwa przewodu [j.]. */
export const K7_HOSE_SEG = 14;

const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// ---------------------------------------------------------------------------------------------------------------
// Kinematyka

/**
 * Odwrotna kinematyka ramienia SCARA: bark w (sx, sz), końcówka w (tx, tz), człony l1, l2. Łokieć po stronie
 * większego z huba (ku bramie G-01), gdy elbowSide > 0. Wynik w `out`: q1 (kąt członu 1 od +x ku +z), q2 (kąt
 * łokcia względem członu 1), reach (czy końcówka w zasięgu).
 */
export function k7ScaraIK(sx, sz, tx, tz, l1, l2, elbowSide, out) {
  const dx = tx - sx;
  const dz = tz - sz;
  const d = Math.max(1e-6, Math.sqrt(dx * dx + dz * dz));
  const c2 = clamp((d * d - l1 * l1 - l2 * l2) / (2 * l1 * l2), -1, 1);
  const base = Math.atan2(dz, dx);
  let bestQ1 = 0;
  let bestQ2 = 0;
  let bestZ = -Infinity;
  for (let k = 0; k < 2; k++) {
    const q2 = (k === 0 ? 1 : -1) * Math.acos(c2);
    const q1 = base - Math.atan2(l2 * Math.sin(q2), l1 + l2 * Math.cos(q2));
    const ez = sz + l1 * Math.sin(q1);
    const score = elbowSide >= 0 ? ez : -ez;
    if (score > bestZ) { bestZ = score; bestQ1 = q1; bestQ2 = q2; }
  }
  out.q1 = bestQ1;
  out.q2 = bestQ2;
  out.reach = d <= l1 + l2 + 1e-6 && d >= Math.abs(l1 - l2) - 1e-6;
  return out;
}

/** Końcówka ramienia (oś wysięgnika) z kątów przegubów. */
export function k7ScaraTip(g, q1, q2, out) {
  const ex = g.sx + g.l1 * Math.cos(q1);
  const ez = g.sz + g.l1 * Math.sin(q1);
  out.ex = ex;
  out.ez = ez;
  out.x = ex + g.l2 * Math.cos(q1 + q2);
  out.z = ez + g.l2 * Math.sin(q1 + q2);
  return out;
}

/**
 * Geometria stanowiska paliwowego (słupek `a` stanowiska `b`, createK7Layout().berths[].serviceAnchors): bark,
 * wylot przewodu z bębna, wlew, kąty przegubów złożonego ramienia i ramienia nad wlewem. Czysta, bez stanu.
 */
export function k7FuelGeometry(b, a) {
  const F = K7_FUEL_STATION;
  const side = a.side;
  const inward = -side;            // ku stanowisku (od słupka)
  const g = {
    berthId: b.id,
    side,
    sx: a.x,
    sz: a.z,
    l1: F.link1.len,
    l2: F.link2.len,
    inward,
    exit: { x: a.x + inward * F.exit.out, y: F.exit.y, z: a.z },
    stowTip: { x: a.x + inward * F.stowTip.out, z: a.z + F.stowTip.along },
    port: { x: a.target.x, y: a.target.y, z: a.target.z },
    wristUp: F.couplerUp + F.wrist,
    wristSeat: a.target.y + F.wrist,
    q1s: 0, q2s: 0, q1w: 0, q2w: 0, dq1: 0
  };
  const ik = { q1: 0, q2: 0, reach: true };
  k7ScaraIK(g.sx, g.sz, g.stowTip.x, g.stowTip.z, g.l1, g.l2, F.elbowSide, ik);
  g.q1s = ik.q1;
  g.q2s = ik.q2;
  k7ScaraIK(g.sx, g.sz, g.port.x, g.port.z, g.l1, g.l2, F.elbowSide, ik);
  g.q1w = ik.q1;
  g.q2w = ik.q2;
  g.reach = ik.reach;
  // bark obraca się krótszą drogą (bez obrotu ramienia przez słupek dookoła)
  g.dq1 = k7AngleDelta(g.q1w, g.q1s);
  return g;
}

/**
 * Kąty przegubów zadane pozą `extension` (0 złożone … 1 nad wlewem). Poza jest już wygładzona przez sekwencję
 * (k7Phase) — tu bez drugiego wygładzenia (ruch nie „stoi” na końcach); bezwładność dodaje napęd przegubów.
 */
export function k7FuelJoints(g, extension, out) {
  const e = clamp(extension, 0, 1);
  out.q1 = g.q1s + g.dq1 * e;
  out.q2 = g.q2s + (g.q2w - g.q2s) * e;
  return out;
}

const _j = { q1: 0, q2: 0 };
const _t = { x: 0, z: 0, ex: 0, ez: 0 };

/**
 * Złączka zadana pozą (bez dynamiki): oś wysięgnika z kątów `extension`, wysokość z `seat` (środek złączki).
 * Źródła gazu hali biorą stąd miejsce pary — tam, gdzie robot niesie złączkę.
 */
export function k7FuelCouplerAt(g, extension, seat, out) {
  k7FuelJoints(g, extension, _j);
  k7ScaraTip(g, _j.q1, _j.q2, _t);
  out.x = _t.x;
  out.z = _t.z;
  out.y = g.wristUp + (g.wristSeat - g.wristUp) * clamp(seat, 0, 1) - K7_FUEL_STATION.wrist;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Przewód

function hoseState(g, index) {
  const M = K7_HOSE_NODES;
  const T = K7_FUEL_TUNE;
  const h = {
    index,
    g,
    berthId: g.berthId,
    side: g.side,
    // napęd ramienia: kąty i prędkości przegubów, wysokość przegubu wysięgnika
    q1: g.q1s, q1v: 0, q2: g.q2s, q2v: 0,
    wy: g.wristUp, wyv: 0,
    tip: { x: 0, z: 0, ex: 0, ez: 0 },
    wrist: { x: 0, y: g.wristUp, z: 0 },
    // przewód: węzły [k0 … M−1], k0 — wylot bębna (stały), M−1 — złączka
    pos: new Float64Array(M * 3),
    prev: new Float64Array(M * 3),
    k0: M - 2,
    sFirst: K7_HOSE_SEG,
    length: K7_HOSE_SEG,
    latched: false,
    lockLast: 0,                // rygiel z poprzedniej klatki — naprowadzanie złączki tylko przy ryglowaniu
    lockRise: 0,
    up: { x: 0, y: 1, z: 0 },   // oś złączki (od środka ku przegubowi; zaryglowana — pion)
    upLatch: 0,                 // przejście osi do pionu przy ryglowaniu
    // uśpienie i wersja geometrii (render wysyła tylko zmienione)
    asleep: false,
    quiet: 0,
    poseKey: NaN,
    hullKey: NaN,
    version: 0,
    latches: 0,
    unlatches: 0,
    kickSeed: index * 0.618 + 0.21
  };
  k7ScaraTip(g, h.q1, h.q2, h.tip);
  h.wrist.x = h.tip.x;
  h.wrist.z = h.tip.z;
  return h;
}

// Przewód rozłożony łukiem (parabola zwisu) od wylotu bębna do złączki, długość `L` — stan początkowy.
function layHose(h, L) {
  const M = K7_HOSE_NODES;
  const s0 = K7_HOSE_SEG;
  const segs = clamp(Math.ceil(L / s0), 2, M - 1);
  h.k0 = M - 1 - segs;
  h.sFirst = L - (segs - 1) * s0;
  h.length = L;
  const E = h.g.exit;
  const C = { x: h.wrist.x, y: h.wy - K7_FUEL_STATION.wrist, z: h.wrist.z };
  const P = h.pos;
  // zwis paraboli dobrany do długości (bisekcja)
  const lenFor = (depth) => {
    let len = 0;
    let px = E.x; let py = E.y; let pz = E.z;
    for (let k = 1; k <= 32; k++) {
      const t = k / 32;
      const x = E.x + (C.x - E.x) * t;
      const y = E.y + (C.y - E.y) * t - 4 * depth * t * (1 - t);
      const z = E.z + (C.z - E.z) * t;
      len += Math.hypot(x - px, y - py, z - pz);
      px = x; py = y; pz = z;
    }
    return len;
  };
  let lo = 0;
  let hi = Math.max(1, L);
  for (let it = 0; it < 40; it++) {
    const mid = (lo + hi) * 0.5;
    if (lenFor(mid) < L) lo = mid; else hi = mid;
  }
  const depth = lo;
  for (let i = h.k0; i < M; i++) {
    const t = (i - h.k0) / (M - 1 - h.k0);
    const o = i * 3;
    P[o] = E.x + (C.x - E.x) * t;
    P[o + 1] = Math.max(K7_FUEL_STATION.hoseR, E.y + (C.y - E.y) * t - 4 * depth * t * (1 - t));
    P[o + 2] = E.z + (C.z - E.z) * t;
  }
  h.prev.set(P);
}

/** Długość przewodu, którą bęben chce wydać dla złączki w C. */
function reelTarget(h, cx, cy, cz, T) {
  const E = h.g.exit;
  const d = Math.sqrt((cx - E.x) ** 2 + (cy - E.y) ** 2 + (cz - E.z) ** 2);
  return clamp(d * T.slack + T.sag, T.minLength, (K7_HOSE_NODES - 2) * K7_HOSE_SEG);
}

/**
 * Stan obsługi paliwowej hali (`layout` — createK7Layout()): przewód z ramieniem na każdym słupku stanowisk capital
 * (8 w hali). Przewody leżą od razu w spoczynku (złożone ramiona, krótka pętla przy bębnie).
 */
export function createK7FuelRig(layout) {
  const hoses = [];
  for (const b of layout.berths) {
    if (b.size !== 'CAPITAL') continue;
    for (const a of b.serviceAnchors) {
      const h = hoseState(k7FuelGeometry(b, a), hoses.length);
      const C = { x: h.wrist.x, y: h.wy - K7_FUEL_STATION.wrist, z: h.wrist.z };
      layHose(h, reelTarget(h, C.x, C.y, C.z, K7_FUEL_TUNE));
      hoses.push(h);
    }
  }
  const rig = {
    hoses,
    time: 0,
    acc: 0,
    hull: null,       // obrys kadłuba w hubie (wypukły, ≥ 3 punkty) albo null
    hullN: 0,
    // krawędzie obrysu: normalna na zewnątrz (nx, nz) i przesunięcie (d) — n·p ≤ d wewnątrz
    _hullE: new Float64Array(64 * 3),
    stats: { awake: 0, substeps: 0, nodes: 0, latched: 0, cpuMs: 0 }
  };
  // ułożenie: krótkie dojście do spoczynku (pętle przy bębnach), bez stanu sprzed budowy
  for (let i = 0; i < 90; i++) stepK7FuelRig(rig, K7_FUEL_TUNE.substep, null, null);
  for (const h of hoses) { h.quiet = 0; h.asleep = false; }
  return rig;
}

// Obrys kadłuba → krawędzie (wypukły wielokąt w hubie). Zwraca liczbę krawędzi (0 = brak kadłuba).
function setHull(rig, hull) {
  if (!hull || hull.length < 3) { rig.hullN = 0; return 0; }
  const n = Math.min(64, hull.length);
  let area = 0;
  for (let i = 0; i < n; i++) {
    const p = hull[i];
    const q = hull[(i + 1) % n];
    area += p.x * q.z - q.x * p.z;
  }
  const s = area >= 0 ? 1 : -1;
  const E = rig._hullE;
  for (let i = 0; i < n; i++) {
    const p = hull[i];
    const q = hull[(i + 1) % n];
    const ex = q.x - p.x;
    const ez = q.z - p.z;
    const l = Math.sqrt(ex * ex + ez * ez) || 1;
    // przy przeciwnym do ruchu wskazówek (area > 0) normalna na zewnątrz = (ez, −ex)
    const nx = (ez / l) * s;
    const nz = (-ex / l) * s;
    E[i * 3] = nx;
    E[i * 3 + 1] = nz;
    E[i * 3 + 2] = nx * p.x + nz * p.z;
  }
  rig.hullN = n;
  return n;
}

function hullKey(hull) {
  if (!hull || hull.length < 3) return 0;
  let k = 0;
  for (let i = 0; i < hull.length; i++) k += hull[i].x * (i + 1.37) + hull[i].z * (i + 2.11);
  return k;
}

function poseKey(pose) {
  if (!pose) return 0;
  return (Number(pose.extension) || 0) * 1.31 + (Number(pose.seat) || 0) * 2.17 + (Number(pose.lock) || 0) * 3.07
    + (Number(pose.flow) || 0) * 0.37 + (Number(pose.vent) || 0) * 0.53 + (Number(pose.clamp) || 0) * 0.19;
}

// Zderzenie węzła (o, promień r) z pokładem, słupkiem i kadłubem; tarcie przy styku. Zwraca 1 przy styku.
function collideNode(rig, h, P, Q, o, r, T) {
  let contact = 0;
  // pokład
  if (P[o + 1] < r) { P[o + 1] = r; contact = 1; }
  // słupek paliwowy (kolumna i cokół): wypchnięcie w poziomie
  const F = K7_FUEL_STATION;
  const g = h.g;
  const dx = P[o] - g.sx;
  const dz = P[o + 2] - g.sz;
  const y = P[o + 1];
  const colTop = y < F.column.top + r;
  const hx = colTop ? (y < F.plinth.h + r ? F.plinth.w * 0.5 : F.column.w * 0.5) + r : -1;
  const hz = colTop ? (y < F.plinth.h + r ? F.plinth.d * 0.5 : F.column.d * 0.5) + r : -1;
  if (colTop && Math.abs(dx) < hx && Math.abs(dz) < hz) {
    const px = hx - Math.abs(dx);
    const pz = hz - Math.abs(dz);
    if (px < pz) P[o] = g.sx + (dx < 0 ? -hx : hx); else P[o + 2] = g.sz + (dz < 0 ? -hz : hz);
    contact = 1;
  }
  // kadłub statku (płyta [spód, szczyt] w obrysie)
  const n = rig.hullN;
  if (n) {
    const yb = K7_HEIGHTS.hullBottom - r;
    const yt = K7_HEIGHTS.hullTop + r;
    if (P[o + 1] < yt && P[o + 1] > yb) {
      const E = rig._hullE;
      let sd = -Infinity;
      let ei = 0;
      for (let i = 0; i < n; i++) {
        const v = E[i * 3] * P[o] + E[i * 3 + 1] * P[o + 2] - E[i * 3 + 2];
        if (v > sd) { sd = v; ei = i; }
      }
      if (sd < r) {
        const up = yt - P[o + 1];
        const outD = r - sd;
        if (up <= outD) P[o + 1] = yt;
        else { P[o] += E[ei * 3] * outD; P[o + 2] += E[ei * 3 + 1] * outD; }
        contact = 1;
      }
    }
  }
  if (contact) {
    const f = T.friction;
    Q[o] += (P[o] - Q[o]) * f;
    Q[o + 2] += (P[o + 2] - Q[o + 2]) * f;
  }
  return contact;
}

const _c = { x: 0, y: 0, z: 0 };

// Jeden podkrok przewodu `h` (czas `dt`) dla pozy `pose`.
function stepHose(rig, h, dt, pose, T) {
  const M = K7_HOSE_NODES;
  const s0 = K7_HOSE_SEG;
  const g = h.g;
  const F = K7_FUEL_STATION;
  const ext = pose ? clamp(Number(pose.extension) || 0, 0, 1) : 0;
  const seat = pose ? clamp(Number(pose.seat) || 0, 0, 1) : 0;
  const lock = pose ? clamp(Number(pose.lock) || 0, 0, 1) : 0;

  // --- napęd ramienia (przeguby i wysięgnik jak masa na sprężynie z tłumieniem)
  k7FuelJoints(g, ext, _j);
  const w = T.jointOmega;
  const z2 = 2 * T.jointZeta * w;
  h.q1v += (w * w * k7AngleDelta(_j.q1, h.q1) - z2 * h.q1v) * dt;
  h.q1 += h.q1v * dt;
  h.q2v += (w * w * (_j.q2 - h.q2) - z2 * h.q2v) * dt;
  h.q2 += h.q2v * dt;
  const wq = T.quillOmega;
  const wyC = g.wristUp + (g.wristSeat - g.wristUp) * seat;
  h.wyv += (wq * wq * (wyC - h.wy) - 2 * T.quillZeta * wq * h.wyv) * dt;
  h.wy += h.wyv * dt;
  k7ScaraTip(g, h.q1, h.q2, h.tip);
  const Wx = h.tip.x;
  const Wy = h.wy;
  const Wz = h.tip.z;
  h.wrist.x = Wx; h.wrist.y = Wy; h.wrist.z = Wz;

  const P = h.pos;
  const Q = h.prev;
  const c = (M - 1) * 3;

  // --- ryglowanie: złączka przy wlewie i rygle zamknięte → siedzi na wlewie; odryglowanie → odrzut
  const port = g.port;
  const cdx = P[c] - port.x;
  const cdy = P[c + 1] - port.y;
  const cdz = P[c + 2] - port.z;
  const cd = Math.sqrt(cdx * cdx + cdy * cdy + cdz * cdz);
  if (!h.latched && lock >= 0.5 && cd < T.latchSnap) {
    h.latched = true;
    h.latches++;
  } else if (h.latched && lock < 0.5) {
    h.latched = false;
    h.unlatches++;
    // odrzut: w górę i na zewnątrz od stanowiska, lekko w bok (deterministycznie)
    const a = (h.kickSeed + h.unlatches * 0.731) * TAU;
    const k = T.unlatchKick * dt;
    Q[c] -= (-g.inward * 0.35 + 0.25 * Math.cos(a)) * k;
    Q[c + 1] -= k;
    Q[c + 2] -= 0.25 * Math.sin(a) * k;
  }

  // --- bęben: długość przewodu (wydawanie / zwijanie), węzły w wylocie
  const Lt = reelTarget(h, h.latched ? port.x : P[c], h.latched ? port.y : P[c + 1], h.latched ? port.z : P[c + 2], T);
  const dL = clamp((Lt - h.length) * dt / Math.max(1e-3, T.reelTau), -T.reelRate * dt, T.reelRate * dt);
  h.length += dL;
  h.sFirst += dL;
  const E = g.exit;
  while (h.sFirst > 1.5 * s0 && h.k0 > 0) {
    // nowy węzeł wylotu: dotychczasowy rusza w przewód na odległość (sFirst − s0) od wylotu
    const k = h.k0;
    const o = k * 3;
    const n1 = (k + 1) * 3;
    const f = (h.sFirst - s0) / h.sFirst;
    P[o] = E.x + (P[n1] - E.x) * f;
    P[o + 1] = E.y + (P[n1 + 1] - E.y) * f;
    P[o + 2] = E.z + (P[n1 + 2] - E.z) * f;
    Q[o] = P[o]; Q[o + 1] = P[o + 1]; Q[o + 2] = P[o + 2];
    h.k0 = k - 1;
    h.sFirst -= s0;
  }
  while (h.sFirst < 0.5 * s0 && M - 1 - h.k0 > 2) {
    h.k0++;
    h.sFirst += s0;
  }
  if (h.sFirst < 0.25 * s0) { h.length += 0.25 * s0 - h.sFirst; h.sFirst = 0.25 * s0; }
  const k0 = h.k0;
  const o0 = k0 * 3;
  P[o0] = E.x; P[o0 + 1] = E.y; P[o0 + 2] = E.z;
  Q[o0] = E.x; Q[o0 + 1] = E.y; Q[o0 + 2] = E.z;

  // --- całkowanie (Verlet z oporem) i grawitacja
  const damp = Math.exp(-T.drag * dt);
  const dampC = Math.exp(-T.couplerDrag * dt);
  const gy = T.gravity * dt * dt;
  let vmax = 0;
  for (let i = k0 + 1; i < M; i++) {
    const o = i * 3;
    if (i === M - 1 && h.latched) continue;
    const d = i === M - 1 ? dampC : damp;
    const vx = (P[o] - Q[o]) * d;
    const vy = (P[o + 1] - Q[o + 1]) * d;
    const vz = (P[o + 2] - Q[o + 2]) * d;
    const v2 = vx * vx + vy * vy + vz * vz;
    if (v2 > vmax) vmax = v2;
    Q[o] = P[o]; Q[o + 1] = P[o + 1]; Q[o + 2] = P[o + 2];
    P[o] += vx;
    P[o + 1] += vy - gy;
    P[o + 2] += vz;
  }

  // --- ograniczenia
  const wC = h.latched ? 0 : 1 / T.couplerMass;
  const lw = F.wrist;
  const its = Math.max(1, T.iterations | 0);
  // sztywność na podkrok rozłożona na przebiegi (inaczej rośnie z ich liczbą — przewód robi się prętem)
  const kb = T.bend > 0 ? 1 - Math.pow(1 - Math.min(0.95, T.bend), 1 / its) : 0;
  for (let it = 0; it < its; it++) {
    // złączka: zaryglowana — na wlewie; wolna — na linie przegubu (najwyżej lw pod wysięgnikiem) i naprowadzanie
    if (h.latched) {
      P[c] = port.x; P[c + 1] = port.y; P[c + 2] = port.z;
    } else {
      let dx = P[c] - Wx;
      let dy = P[c + 1] - Wy;
      let dz = P[c + 2] - Wz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > lw) {
        const f = (d - lw) / d;
        P[c] -= dx * f; P[c + 1] -= dy * f; P[c + 2] -= dz * f;
      }
      // przegub: miękki powrót pod wysięgnik (złączka nie dynda jak na sznurku)
      const ws = T.wristStiff;
      P[c] += (Wx - P[c]) * ws;
      P[c + 2] += (Wz - P[c + 2]) * ws;
      if (lock > 0 && h.lockRise && cd < T.guide) {
        const gk = Math.min(1, lock * 0.6);
        P[c] += (port.x - P[c]) * gk;
        P[c + 1] += (port.y - P[c + 1]) * gk;
        P[c + 2] += (port.z - P[c + 2]) * gk;
      }
    }
    // ogniwa przewodu (na zmianę od bębna i od złączki — bez kierunkowego nachylenia)
    const fwd = (it & 1) === 0;
    for (let s = 0; s < M - 1 - k0; s++) {
      const i = fwd ? k0 + s : M - 2 - s;
      const a = i * 3;
      const b = a + 3;
      const wa = i === k0 ? 0 : 1;
      const wb = i + 1 === M - 1 ? wC : 1;
      const sw = wa + wb;
      if (sw <= 0) continue;
      const rest = i === k0 ? h.sFirst : s0;
      const dx = P[b] - P[a];
      const dy = P[b + 1] - P[a + 1];
      const dz = P[b + 2] - P[a + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      const f = (d - rest) / (d * sw);
      P[a] += dx * f * wa; P[a + 1] += dy * f * wa; P[a + 2] += dz * f * wa;
      P[b] -= dx * f * wb; P[b + 1] -= dy * f * wb; P[b + 2] -= dz * f * wb;
    }
    // zginanie: węzeł ku środkowi sąsiadów (przewód gruby i ciężki — łagodne łuki, bez załamań)
    if (kb > 0) {
      for (let i = k0 + 1; i < M - 1; i++) {
        const o = i * 3;
        P[o] += ((P[o - 3] + P[o + 3]) * 0.5 - P[o]) * kb;
        P[o + 1] += ((P[o - 2] + P[o + 4]) * 0.5 - P[o + 1]) * kb;
        P[o + 2] += ((P[o - 1] + P[o + 5]) * 0.5 - P[o + 2]) * kb;
      }
    }
  }
  // --- zderzenia (pokład, słupek, kadłub) i tarcie
  const r = F.hoseR;
  for (let i = k0 + 1; i < M - 1; i++) collideNode(rig, h, P, Q, i * 3, r, T);
  if (!h.latched) collideNode(rig, h, P, Q, c, F.coupler.half, T);

  // --- oś złączki: od środka ku przegubowi; zaryglowana — pion (płynnie)
  h.upLatch += ((h.latched ? 1 : 0) - h.upLatch) * Math.min(1, dt * 10);
  let ux = Wx - P[c];
  let uy = Wy - P[c + 1];
  let uz = Wz - P[c + 2];
  const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
  if (ul > 1e-3) { ux /= ul; uy /= ul; uz /= ul; } else { ux = 0; uy = 1; uz = 0; }
  const kl = h.upLatch;
  ux *= 1 - kl; uy = uy * (1 - kl) + kl; uz *= 1 - kl;
  const ll = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
  h.up.x = ux / ll; h.up.y = uy / ll; h.up.z = uz / ll;

  return Math.sqrt(vmax) / dt + Math.abs(h.q1v) * g.l1 + Math.abs(h.q2v) * g.l2 + Math.abs(h.wyv) + Math.abs(dL) / dt;
}

/**
 * Krok obsługi paliwowej hali: dt — czas gry [s] (0 = stoi), poses — Map berthId → poza obsługi (rejestr hali;
 * null — wszystko złożone), hull — obrys kadłuba statku w hubie TEJ hali (wypukły, punkty { x, z }) albo null.
 * Stały podkrok; przewód, którego poza, kadłub i ruch stoją, śpi (zero pracy).
 */
export function stepK7FuelRig(rig, dt, poses, hull) {
  const T = K7_FUEL_TUNE;
  const st = rig.stats;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  st.substeps = 0;
  st.awake = 0;
  st.nodes = 0;
  st.latched = 0;
  const step = dt > 0 ? Math.min(dt, T.substep * T.maxSubsteps) : 0;
  rig.acc += step;
  let n = 0;
  while (rig.acc >= T.substep && n < T.maxSubsteps) { rig.acc -= T.substep; n++; }
  if (n >= T.maxSubsteps) rig.acc = 0;
  const hk = hullKey(hull);
  setHull(rig, hull);
  for (const h of rig.hoses) {
    const pose = poses && typeof poses.get === 'function' ? poses.get(h.berthId) || null : null;
    const pk = poseKey(pose);
    // kierunek rygla (z klatki na klatkę): naprowadzanie złączki na wlew tylko przy ryglowaniu, nie przy odryglowaniu
    if (n > 0) {
      const lk = pose ? clamp(Number(pose.lock) || 0, 0, 1) : 0;
      if (lk > h.lockLast + 1e-9) h.lockRise = 1;
      else if (lk < h.lockLast - 1e-9) h.lockRise = 0;
      h.lockLast = lk;
    }
    if (pk !== h.poseKey || (hk !== h.hullKey && hullNear(rig, h))) { h.asleep = false; h.quiet = 0; }
    h.poseKey = pk;
    h.hullKey = hk;
    if (h.latched) st.latched++;
    if (h.asleep || n === 0) continue;
    let speed = 0;
    for (let s = 0; s < n; s++) speed = Math.max(speed, stepHose(rig, h, T.substep, pose, T));
    h.version++;
    st.awake++;
    st.nodes += K7_HOSE_NODES - h.k0;
    h.quiet = speed < T.sleepSpeed ? h.quiet + n * T.substep : 0;
    if (h.quiet > T.sleepAfter) h.asleep = true;
  }
  st.substeps = n;
  rig.time += step;
  if (t0) st.cpuMs = performance.now() - t0;
  return st;
}

// Kadłub w pobliżu przewodu (zmiana obrysu daleko od słupka nie budzi przewodu).
function hullNear(rig, h) {
  if (!rig.hullN) return true;   // kadłub zniknął — przewód mógł na nim leżeć
  const E = rig._hullE;
  const g = h.g;
  const R = Math.hypot(g.l1 + g.l2, 0) + 200;
  for (let i = 0; i < rig.hullN; i++) {
    const v = E[i * 3] * g.sx + E[i * 3 + 1] * g.sz - E[i * 3 + 2];
    if (v > R) return false;
  }
  return true;
}

/** Budzi wszystkie przewody (zmiana strojenia, reset). */
export function wakeK7FuelRig(rig) {
  for (const h of rig.hoses) { h.asleep = false; h.quiet = 0; }
}
