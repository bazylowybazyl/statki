// ZESTAW — TAŚMOCIĄG: tor taśmy (czysta matematyka, bez three i DOM).
//
// Taśmociąg to JEDNA ciągła taśma po torze z łamanej [x, y, z] (y — wysokość, plan w płaszczyźnie x–z):
//   • zakręty w PLANIE są łukami koła o promieniu `radius` (styczne do obu odcinków — taśma nie ma narożników);
//   • zmiany pochylenia są łagodne: przy każdym załamaniu niwelety parabola o długości `vertical` (nachylenie zmienia
//     się liniowo, bez skoku) — jak łuk pionowy drogi;
//   • wierzchołek z y = null nie łamie niwelety: wysokość bierze z prostej między sąsiadami o podanej wysokości
//     (zakręt w planie ze stałym pochyleniem).
// Tor jest próbkowany RAZ po długości 3D (tablica co `step`), potem każde zapytanie to odczyt tablicy z interpolacją —
// bez alokacji (ziarna rudy pytają o tysiące punktów na migawkę). Długość `s` liczona jest po taśmie (3D), od początku.
//
// Układ przekroju w punkcie s: styczna t (kierunek jazdy), normalna BOCZNA n (pozioma, w prawo od kierunku jazdy
// w planie x–z patrząc z góry przy osi z w dół ekranu: n = (t.z, 0, −t.x) / |t poziome|), normalna taśmy u = t × n
// (prostopadła do taśmy, ku górze). Taśma nie jest przechylana na łuku. Punkt przekroju: P(s) + n · bok + u · wysokość.
//
// Użycie: `const tor = createConveyorTrack({ pts, radius: 220, vertical: 160 })`, `tor.point(s, bok, wys, out, o)`,
// `tor.frame(s, F)`; w gorącej pętli `tor.pointFrom([s, bok, wys], out, o)`. Obraz: `kit/tasmociag3d.js`.

/** Liczba pól ramki `frame()`: pozycja 0–2, styczna 3–5, normalna boczna 6–8, normalna taśmy 9–11. */
export const CONVEYOR_FRAME = 12;

/**
 * @param {object} o
 * @param {Array<Array<number|null>>} o.pts   wierzchołki łamanej [x, y, z]; y = null — wysokość z prostej między sąsiadami
 * @param {number} [o.radius]    promień zakrętu w planie [j.] (albo tablica promieni na wierzchołek)
 * @param {number} [o.vertical]  długość łuku pionowego przy załamaniu niwelety [j. w planie]
 * @param {number} [o.width]     szerokość taśmy [j.]
 * @param {number} [o.step]      krok tablicy po długości taśmy [j.]
 */
export function createConveyorTrack({ pts, radius = 200, vertical = 160, width = 60, step = 2 } = {}) {
  const n = pts ? pts.length : 0;
  if (n < 2) throw new Error('tasmociag: tor wymaga co najmniej dwóch punktów');
  if (!(step > 0)) throw new Error('tasmociag: krok tablicy musi być dodatni');
  if (pts[0][1] == null || pts[n - 1][1] == null) throw new Error('tasmociag: pierwszy i ostatni punkt muszą mieć wysokość');

  // ------------------------------------------------------------------ plan: odcinki proste i łuki
  // odcinek: [rodzaj 0 prosta / 1 łuk, u0, długość, x0, z0, dx, dz]  albo  [1, u0, długość, cx, cz, r, a0, znak]
  const segs = [];
  const corners = [];
  const station = new Float64Array(n);          // droga w planie do wierzchołka (zakręt: środek łuku)
  let u = 0;
  let px = pts[0][0];
  let pz = pts[0][2];
  const line = (x1, z1) => {
    const dx = x1 - px;
    const dz = z1 - pz;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len > 1e-9) { segs.push([0, u, len, px, pz, dx / len, dz / len]); u += len; }
    px = x1; pz = z1;
  };
  for (let i = 1; i < n; i++) {
    const B = pts[i];
    if (i === n - 1) { line(B[0], B[2]); station[i] = u; break; }
    const A = pts[i - 1];
    const C = pts[i + 1];
    let ux = B[0] - A[0];
    let uz = B[2] - A[2];
    let wx = C[0] - B[0];
    let wz = C[2] - B[2];
    const la = Math.sqrt(ux * ux + uz * uz);
    const lc = Math.sqrt(wx * wx + wz * wz);
    if (la < 1e-6 || lc < 1e-6) throw new Error(`tasmociag: punkty ${i - 1}…${i + 1} pokrywają się w planie`);
    ux /= la; uz /= la; wx /= lc; wz /= lc;
    const dot = Math.max(-1, Math.min(1, ux * wx + uz * wz));
    const phi = Math.acos(dot);
    const r0 = Array.isArray(radius) ? radius[i] || 0 : radius;
    if (phi < 1e-4 || !(r0 > 0)) {
      if (phi >= 1e-4) throw new Error(`tasmociag: zakręt w punkcie ${i} bez promienia — taśma nie ma narożników`);
      line(B[0], B[2]);
      station[i] = u;
      continue;
    }
    let t = r0 * Math.tan(phi / 2);
    // styczne nie mogą wyjść poza połowę odcinka sąsiadującego z kolejnym zakrętem (ani poza cały odcinek skrajny)
    const tMax = Math.min(i === 1 ? la : la * 0.5, i === n - 2 ? lc : lc * 0.5);
    let r = r0;
    if (t > tMax) { r = r0 * (tMax / t); t = tMax; }
    const sgn = ux * wz - uz * wx > 0 ? 1 : -1;
    const p1x = B[0] - ux * t;
    const p1z = B[2] - uz * t;
    line(p1x, p1z);
    const cx = p1x - uz * sgn * r;
    const cz = p1z + ux * sgn * r;
    const a0 = Math.atan2(p1z - cz, p1x - cx);
    const len = r * phi;
    segs.push([1, u, len, cx, cz, r, a0, sgn]);
    corners.push({ index: i, r, phi, cx, cz, u0: u, u1: u + len, s0: 0, s1: 0 });
    station[i] = u + len / 2;
    u += len;
    px = B[0] + wx * t;
    pz = B[2] + wz * t;
  }
  const planLength = u;
  const _pl = new Float64Array(4);               // x, z, tx, tz w planie
  let segHint = 0;
  function plan(uu) {
    let k = segHint;
    if (k >= segs.length) k = segs.length - 1;
    while (k > 0 && segs[k][1] > uu) k--;
    while (k < segs.length - 1 && segs[k][1] + segs[k][2] < uu) k++;
    segHint = k;
    const g = segs[k];
    const d = uu - g[1];
    if (g[0] === 0) {
      _pl[0] = g[3] + g[5] * d; _pl[1] = g[4] + g[6] * d; _pl[2] = g[5]; _pl[3] = g[6];
    } else {
      const a = g[6] + g[7] * d / g[5];
      const c = Math.cos(a);
      const s = Math.sin(a);
      _pl[0] = g[3] + c * g[5]; _pl[1] = g[4] + s * g[5]; _pl[2] = -s * g[7]; _pl[3] = c * g[7];
    }
  }

  // ------------------------------------------------------------------ niweleta: proste + parabole przy załamaniach
  const cu = [];
  const cy = [];
  for (let i = 0; i < n; i++) if (pts[i][1] != null) { cu.push(station[i]); cy.push(pts[i][1]); }
  const m = cu.length;
  for (let k = 1; k < m; k++) if (!(cu[k] > cu[k - 1])) throw new Error('tasmociag: punkty niwelety nie rosną po drodze');
  const grade = new Float64Array(m);            // nachylenie odcinka k → k + 1
  for (let k = 0; k < m - 1; k++) grade[k] = (cy[k + 1] - cy[k]) / (cu[k + 1] - cu[k]);
  const halfV = new Float64Array(m);            // połowa długości łuku pionowego przy punkcie k
  for (let k = 1; k < m - 1; k++) {
    if (Math.abs(grade[k] - grade[k - 1]) < 1e-9) continue;
    const before = (cu[k] - cu[k - 1]) * (k === 1 ? 1 : 0.5);
    const after = (cu[k + 1] - cu[k]) * (k === m - 2 ? 1 : 0.5);
    halfV[k] = Math.min(vertical / 2, before, after);
  }
  const _pr = new Float64Array(2);               // y, dy/du
  function profile(uu) {
    let k = 0;
    while (k < m - 2 && cu[k + 1] < uu) k++;
    // łuk pionowy przy początku albo końcu odcinka k
    const L0 = halfV[k];
    const L1 = k + 1 < m - 1 ? halfV[k + 1] : 0;
    if (L0 > 0 && uu < cu[k] + L0) {
      const g0 = grade[k - 1];
      const dg = grade[k] - g0;
      const q = uu - cu[k] + L0;
      _pr[0] = cy[k] + g0 * (uu - cu[k]) + dg * q * q / (4 * L0);
      _pr[1] = g0 + dg * q / (2 * L0);
    } else if (L1 > 0 && uu > cu[k + 1] - L1) {
      const g0 = grade[k];
      const dg = grade[k + 1] - g0;
      const q = uu - cu[k + 1] + L1;
      _pr[0] = cy[k + 1] + g0 * (uu - cu[k + 1]) + dg * q * q / (4 * L1);
      _pr[1] = g0 + dg * q / (2 * L1);
    } else {
      _pr[0] = cy[k] + grade[k] * (uu - cu[k]);
      _pr[1] = grade[k];
    }
  }

  // ------------------------------------------------------------------ tablica po długości taśmy
  // 1) gęsta tablica długości 3D po drodze w planie, 2) węzły co `step` po długości 3D: pozycja, styczna, droga w planie
  const FINE = Math.max(64, Math.ceil(planLength / Math.min(0.5, step / 4)));
  const fineS = new Float64Array(FINE + 1);
  {
    let lx = 0; let ly = 0; let lz = 0;
    for (let i = 0; i <= FINE; i++) {
      const uu = planLength * i / FINE;
      plan(uu); profile(uu);
      if (i > 0) { const dx = _pl[0] - lx; const dy = _pr[0] - ly; const dz = _pl[1] - lz; fineS[i] = fineS[i - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz); }
      lx = _pl[0]; ly = _pr[0]; lz = _pl[1];
    }
  }
  const length = fineS[FINE];
  const N = Math.ceil(length / step);            // liczba przęseł tablicy
  const ds = length / N;
  const T = new Float64Array((N + 1) * 6);       // x, y, z, tx, ty, tz
  const U = new Float64Array(N + 1);             // droga w planie węzła
  let maxSlope = 0;
  {
    let j = 0;
    for (let i = 0; i <= N; i++) {
      const s = i === N ? length : i * ds;
      while (j < FINE - 1 && fineS[j + 1] < s) j++;
      const span = fineS[j + 1] - fineS[j];
      const uu = planLength * (j + (span > 1e-12 ? (s - fineS[j]) / span : 0)) / FINE;
      plan(uu); profile(uu);
      const k = 1 / Math.sqrt(1 + _pr[1] * _pr[1]);
      const o = i * 6;
      T[o] = _pl[0]; T[o + 1] = _pr[0]; T[o + 2] = _pl[1];
      T[o + 3] = _pl[2] * k; T[o + 4] = _pr[1] * k; T[o + 5] = _pl[3] * k;
      U[i] = uu;
      const sl = Math.atan(Math.abs(_pr[1]));
      if (sl > maxSlope) maxSlope = sl;
    }
  }
  /** Długość po taśmie dla drogi w planie `uu` (odwrotność tablicy U). */
  function sAtPlan(uu) {
    if (uu <= 0) return 0;
    if (uu >= planLength) return length;
    let lo = 0;
    let hi = N;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (U[mid] <= uu) lo = mid; else hi = mid; }
    const span = U[hi] - U[lo];
    return (lo + (span > 1e-12 ? (uu - U[lo]) / span : 0)) * ds;
  }
  let minRadius = Infinity;
  for (const c of corners) { c.s0 = sAtPlan(c.u0); c.s1 = sAtPlan(c.u1); if (c.r < minRadius) minRadius = c.r; Object.freeze(c); }

  // Rdzeń odczytu: droga `_in[0]` → ramka w `_f` (pozycja, styczna, normalna boczna, normalna taśmy). Wejście i wyjście
  // przez tablice typowane: liczba ułamkowa podana jako argument wywołania nieinlinowanej funkcji alokuje w V8.
  // Poza końcami tor biegnie dalej po prostej (styczna z końca) — pozycja „sprzed kroku” ziarna tuż za początkiem
  // i ziarno o ułamek komórki za końcem nie skaczą.
  const _in = new Float64Array(1);
  const _f = new Float64Array(CONVEYOR_FRAME);
  function core() {
    const s = _in[0];
    let i = Math.floor(s / ds);
    if (i < 0) i = 0; else if (i > N - 1) i = N - 1;
    const f = s / ds - i;
    const a = i * 6;
    let tx; let ty; let tz;
    if (f < 0 || f > 1) {
      const e = f < 0 ? a : a + 6;
      const d = f < 0 ? s : s - length;
      tx = T[e + 3]; ty = T[e + 4]; tz = T[e + 5];
      _f[0] = T[e] + tx * d; _f[1] = T[e + 1] + ty * d; _f[2] = T[e + 2] + tz * d;
    } else {
      const g = 1 - f;
      _f[0] = T[a] * g + T[a + 6] * f; _f[1] = T[a + 1] * g + T[a + 7] * f; _f[2] = T[a + 2] * g + T[a + 8] * f;
      tx = T[a + 3] * g + T[a + 9] * f; ty = T[a + 4] * g + T[a + 10] * f; tz = T[a + 5] * g + T[a + 11] * f;
      const k = 1 / Math.sqrt(tx * tx + ty * ty + tz * tz);
      tx *= k; ty *= k; tz *= k;
    }
    const L = Math.sqrt(tx * tx + tz * tz);
    const nx = tz / L;
    const nz = -tx / L;
    _f[3] = tx; _f[4] = ty; _f[5] = tz;
    _f[6] = nx; _f[7] = 0; _f[8] = nz;
    _f[9] = nz * ty; _f[10] = L; _f[11] = -nx * ty;       // u = t × n
  }
  /** Ramka przekroju w punkcie `s`: `F` (12 liczb od `o`) = pozycja, styczna, normalna boczna, normalna taśmy. */
  function frame(s, F, o = 0) {
    _in[0] = s;
    core();
    for (let k = 0; k < CONVEYOR_FRAME; k++) F[o + k] = _f[k];
    return F;
  }
  /** Punkt przekroju: (s, przesunięcie w poprzek `lat`, wysokość nad taśmą `h`) → out[o…o + 2] = x, y, z. */
  function point(s, lat, h, out, o = 0) {
    _in[0] = s;
    core();
    out[o] = _f[0] + _f[6] * lat + _f[9] * h;
    out[o + 1] = _f[1] + _f[10] * h;
    out[o + 2] = _f[2] + _f[8] * lat + _f[11] * h;
    return out;
  }
  /**
   * To samo co `point`, ale wejście z tablicy `inp` = [s, bok, wysokość] (od `i`) — GORĄCA ŚCIEŻKA bez alokacji
   * (tysiące ziaren na migawkę): żadna liczba ułamkowa nie idzie przez argument wywołania.
   */
  function pointFrom(inp, out, o, i = 0) {
    _in[0] = inp[i];
    core();
    const lat = inp[i + 1];
    const h = inp[i + 2];
    out[o] = _f[0] + _f[6] * lat + _f[9] * h;
    out[o + 1] = _f[1] + _f[10] * h;
    out[o + 2] = _f[2] + _f[8] * lat + _f[11] * h;
  }
  /** Pierwsza długość s (≥ `from`), przy której powierzchnia taśmy osiąga wysokość `y` (−1 — nie osiąga). */
  function sAtHeight(y, from = 0) {
    for (let i = Math.max(0, Math.floor(from / ds)); i < N; i++) {
      const y0 = T[i * 6 + 1];
      const y1 = T[i * 6 + 7];
      if ((y0 - y) * (y1 - y) <= 0 && y0 !== y1) return (i + (y - y0) / (y1 - y0)) * ds;
    }
    return -1;
  }
  /** Długość s punktu toru najbliższego (x, z) w planie. */
  function nearest(x, z) {
    let best = Infinity;
    let bs = 0;
    for (let i = 0; i < N; i++) {
      const a = i * 6;
      const dx = T[a + 6] - T[a];
      const dz = T[a + 8] - T[a + 2];
      const l2 = dx * dx + dz * dz;
      let f = l2 > 1e-12 ? ((x - T[a]) * dx + (z - T[a + 2]) * dz) / l2 : 0;
      f = f < 0 ? 0 : f > 1 ? 1 : f;
      const qx = T[a] + dx * f - x;
      const qz = T[a + 2] + dz * f - z;
      const q = qx * qx + qz * qz;
      if (q < best) { best = q; bs = (i + f) * ds; }
    }
    return bs;
  }

  return Object.freeze({
    length, planLength, width, step: ds, nodes: N + 1,
    /** najmniejszy promień zakrętu w planie [j.] (Infinity — tor prosty) i największe nachylenie [rad] */
    minRadius, maxSlope,
    corners: Object.freeze(corners),
    frame, point, pointFrom, sAtPlan, sAtHeight, nearest
  });
}

/**
 * Przekrój taśmociągu [j.] — bok liczony od osi, wysokość od powierzchni nitki górnej. `halfWidth` — połowa szerokości
 * taśmy (z toru); rama i burty leżą na zewnątrz.
 */
export function conveyorSection(halfWidth) {
  const hw = halfWidth;
  return Object.freeze({
    flat: hw - 7,            // płaski środek niecki
    lip: 3.5,                // uniesienie brzegu taśmy
    edge: hw + 2,            // brzeg taśmy (niecka zachodzi pod burty)
    returnY: -13,            // nitka dolna
    returnHalf: hw - 2,
    frame0: hw + 1, frame1: hw + 8, frameTop: -9, frameBottom: -17,     // podłużnica
    skirt0: hw + 4, skirt1: hw + 6.5, skirtBottom: 2, skirtTop: 10,     // burta (światło między burtami = taśma + 8 j.)
    idlerTop: -1, idlerBottom: -8, idlerHalf: hw + 5, idlerLength: 6,
    postHalf: 1.6,
    outer: hw + 8,           // największy bok bryły (obrys do podpór i wycięć)
    bottom: -17              // spód ramy
  });
}
