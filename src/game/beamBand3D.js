/**
 * PAS GRY dla BRYŁ 3D silnika belek (docs/PORT-silnik-belek.md § „Ciała 3D” — trafienia brył; prośba użytkownika
 * 2026-10-15: „rzeczom 2D przy rzeczach 3D dać hitboxy 3D, żeby mogły normalnie rozwalać świat 3D”).
 *
 * Rozgrywka jest w płaszczyźnie gry (z = 0), więc rzeczy 2D dostają dla brył WYSOKOŚĆ: okręt to słup ±
 * HULL_BODY_CONFIG.shipColumn (pary mieszane silnika), a broń gry (pocisk, wiązka, rzaz Hexlance'a, orka) leci w tym
 * samym PASIE |z| ≤ pół-wysokość. Węzeł bryły jest w pasie, gdy jego wysokość świata mieści się w pasie poszerzonym
 * o pół komórki (kula węzła dotyka pasa). Co bryła ma poza pasem (wieża nad bębnem, dysk pod płaszczyzną) — broń
 * przelatuje nad nią / pod nią, jak okręt.
 *
 * INDEKS PASA ciała: węzły w pasie z położeniem świata (X, Y, Z silnika: x gry, −y gry, wysokość) w siatce 2D o boku
 * komórki ciała — przekrój bryły z pasem jest dla broni zwykłym „płaskim ciałem” w świecie (odcinek, sonda, kapsuła,
 * koło). Indeks żyje na ciele (`body._band`) do zmiany pozy, nowego kroku fizyki (ciało w ruchu, solver rusza węzły)
 * albo zmiany geometrii z poprzedniego kroku; trafienia w tym samym kroku tylko gaszą węzły (odczyt sprawdza `active`),
 * więc seria pocisków w jedną bryłę nie przebudowuje indeksu po każdym kraterze. `now` — czas symulacji kroku
 * (HullBodies.simTime): bez zmiany pozy i z ciałem uśpionym indeks przeżywa kroki.
 *
 * Bez three i DOM; zero alokacji na zapytanie (bufory indeksu rosną tylko przy przebudowie).
 */

/** Macierz obrotu z kwaternionu (wiersze: świat ← ciało, jak quatToMat3 silnika) do `m` (Float64Array(9)). */
export function bodyRotation(q, m) {
  const x = q.x, y = q.y, z = q.z, w = q.w;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  m[0] = 1 - 2 * (yy + zz); m[1] = 2 * (xy - wz); m[2] = 2 * (xz + wy);
  m[3] = 2 * (xy + wz); m[4] = 1 - 2 * (xx + zz); m[5] = 2 * (yz - wx);
  m[6] = 2 * (xz - wy); m[7] = 2 * (yz + wx); m[8] = 1 - 2 * (xx + yy);
  return m;
}

// Siatka indeksu: najwyżej tyle kubełków (większy przekrój — bok kubełka × 2, aż się zmieści).
const MAX_BUCKETS = 1 << 18;

function createIndex() {
  return {
    store: null, t: NaN, geom: -1, halfH: -1,
    px: NaN, py: NaN, pz: NaN, qx: NaN, qy: NaN, qz: NaN, qw: NaN,
    n: 0, cap: 0,
    idx: new Int32Array(0), x: new Float64Array(0), y: new Float64Array(0), z: new Float64Array(0),
    next: new Int32Array(0), heads: new Int32Array(0),
    g: 1, gx0: 0, gy0: 0, gnx: 0, gny: 0,
    m: new Float64Array(9)
  };
}

function samePose(B, body) {
  const p = body.pos, q = body.quat;
  return B.px === p.x && B.py === p.y && B.pz === p.z && B.qx === q.x && B.qy === q.y && B.qz === q.z && B.qw === q.w;
}

/**
 * Indeks pasa ciała (bryła 3D): węzły z |z świata| ≤ halfH + ½ komórki. Przebudowa: nowy magazyn węzłów, inna poza,
 * inny pas, albo nowy krok (`now`), gdy ciało nie śpi albo zmieniło geometrię w poprzednim kroku. Zwraca indeks
 * (pole `n` — liczba węzłów w pasie; 0 = bryła całkiem poza pasem).
 */
export function bandIndex(body, halfH, now) {
  let B = body._band;
  if (!B) B = body._band = createIndex();
  const s = body.nodeStore;
  if (B.store === s && B.halfH === halfH && samePose(B, body) &&
      (B.t === now || (body.isSleeping && B.geom === body._geomVer))) return B;
  buildIndex(B, body, halfH, now);
  return B;
}

/** Wymusza przebudowę indeksu przy następnym zapytaniu (np. węzły przesunięte poza silnikiem). */
export function invalidateBand(body) {
  if (!body || !body._band) return;
  body._band.t = NaN;
  body._band.store = null;
}

function buildIndex(B, body, halfH, now) {
  const s = body.nodeStore, cs = body.cellSize, m = bodyRotation(body.quat, B.m);
  const p = body.pos, q = body.quat;
  B.store = s; B.t = now; B.geom = body._geomVer; B.halfH = halfH;
  B.px = p.x; B.py = p.y; B.pz = p.z; B.qx = q.x; B.qy = q.y; B.qz = q.z; B.qw = q.w;
  B.n = 0;
  const lim = halfH + 0.5 * cs;
  // szybki test: pudło ciała (zachowawcze — rośnie z ruchem węzłów) w wysokości świata
  const lb = body._localBounds;
  if (lb) {
    const zc = p.z + m[6] * lb[0] + m[7] * lb[1] + m[8] * lb[2];
    const zh = Math.abs(m[6]) * lb[3] + Math.abs(m[7]) * lb[4] + Math.abs(m[8]) * lb[5] + (body._maxDisp || 0) + cs;
    if (zc - zh > lim || zc + zh < -lim) return B;
  }
  if (B.cap < s.count) {
    const cap = Math.max(s.count, B.cap * 2, 64);
    B.idx = new Int32Array(cap); B.x = new Float64Array(cap); B.y = new Float64Array(cap); B.z = new Float64Array(cap);
    B.next = new Int32Array(cap);
    B.cap = cap;
  }
  const X = s.x, Y = s.y, Z = s.z, active = s.active;
  const bx = B.x, by = B.y, bz = B.z, bi = B.idx;
  let n = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < s.count; i++) {
    if (!active[i]) continue;
    const lx = X[i], ly = Y[i], lz = Z[i];
    const wz = p.z + m[6] * lx + m[7] * ly + m[8] * lz;
    if (wz > lim || wz < -lim) continue;
    const wx = p.x + m[0] * lx + m[1] * ly + m[2] * lz;
    const wy = p.y + m[3] * lx + m[4] * ly + m[5] * lz;
    bi[n] = i; bx[n] = wx; by[n] = wy; bz[n] = wz;
    if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
    if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
    n++;
  }
  B.n = n;
  if (n === 0) return B;
  let g = cs;
  let gx0 = Math.floor(minX / g), gy0 = Math.floor(minY / g);
  let gnx = Math.floor(maxX / g) - gx0 + 1, gny = Math.floor(maxY / g) - gy0 + 1;
  while (gnx * gny > MAX_BUCKETS) {
    g *= 2;
    gx0 = Math.floor(minX / g); gy0 = Math.floor(minY / g);
    gnx = Math.floor(maxX / g) - gx0 + 1; gny = Math.floor(maxY / g) - gy0 + 1;
  }
  B.g = g; B.gx0 = gx0; B.gy0 = gy0; B.gnx = gnx; B.gny = gny;
  const cells = gnx * gny;
  if (B.heads.length < cells) B.heads = new Int32Array(Math.max(cells, B.heads.length * 2));
  const heads = B.heads, next = B.next;
  heads.fill(-1, 0, cells);
  for (let k = 0; k < n; k++) {
    const c = (Math.floor(bx[k] / g) - gx0) + gnx * (Math.floor(by[k] / g) - gy0);
    next[k] = heads[c];
    heads[c] = k;
  }
  return B;
}

/** Wynik ostatniego bandSweep / bandProbe (wspólny): t (ułamek odcinka), node, k (slot indeksu), x, y, z węzła. */
export const bandHit = { t: Infinity, node: -1, k: -1, x: 0, y: 0, z: 0 };

/**
 * Odcinek (X0, Y0) → (X1, Y1) w świecie SILNIKA (y odwrócone względem gry) przeciw kołom węzłów pasa o promieniu
 * `reach`: pierwszy żywy węzeł na drodze (jak sweepLocal2D ciała płaskiego). Węzły jednej kolumny (ta sama XY, różne
 * wysokości) wchodzą razem — z remisu (droga w ćwierć komórki) wygrywa węzeł najbliżej płaszczyzny gry (tam leci
 * pocisk; krater ma środek na jego wysokości). Wynik w bandHit; zwraca węzeł albo −1.
 */
export function bandSweep(body, X0, Y0, X1, Y1, reach, halfH, now) {
  const h = bandHit;
  h.t = Infinity; h.node = -1; h.k = -1;
  if (!body || body.dead || body.activeNodes <= 0) return -1;
  const B = bandIndex(body, halfH, now);
  if (B.n === 0) return -1;
  const g = B.g, gx0 = B.gx0, gy0 = B.gy0, gnx = B.gnx, gny = B.gny;
  const minYs = Math.min(Y0, Y1) - reach, maxYs = Math.max(Y0, Y1) + reach;
  const row0 = Math.max(0, Math.floor(minYs / g) - gy0), row1 = Math.min(gny - 1, Math.floor(maxYs / g) - gy0);
  if (row1 < row0) return -1;
  const minXs = Math.min(X0, X1) - reach, maxXs = Math.max(X0, X1) + reach;
  if (Math.floor(maxXs / g) - gx0 < 0 || Math.floor(minXs / g) - gx0 >= gnx) return -1;
  const dx = X1 - X0, dy = Y1 - Y0, a = dx * dx + dy * dy, r2 = reach * reach;
  const heads = B.heads, next = B.next, bx = B.x, by = B.y, bz = B.z, bi = B.idx, active = body.nodeStore.active;
  // remis kolumny: ćwierć komórki drogi (w ułamku odcinka)
  const eps = a > 1e-18 ? (0.25 * body.cellSize) / Math.sqrt(a) : 0;
  let bestT = Infinity, bestK = -1, bestAz = Infinity;
  for (let iy = row0; iy <= row1; iy++) {
    const cy0 = (gy0 + iy) * g - reach, cy1 = (gy0 + iy + 1) * g + reach;
    let tLo = 0, tHi = 1;
    if (Math.abs(dy) > 1e-12) {
      let ta = (cy0 - Y0) / dy, tb = (cy1 - Y0) / dy;
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
      if (ta > tLo) tLo = ta;
      if (tb < tHi) tHi = tb;
      if (tLo > tHi) continue;
    } else if (Y0 < cy0 || Y0 > cy1) continue;
    if (tLo > bestT + eps) continue;
    const xa = X0 + dx * tLo, xb = X0 + dx * tHi;
    const col0 = Math.max(0, Math.floor((Math.min(xa, xb) - reach) / g) - gx0);
    const col1 = Math.min(gnx - 1, Math.floor((Math.max(xa, xb) + reach) / g) - gx0);
    const rowBase = iy * gnx;
    for (let ix = col0; ix <= col1; ix++) {
      for (let k = heads[rowBase + ix]; k >= 0; k = next[k]) {
        if (!active[bi[k]]) continue;
        const fx = X0 - bx[k], fy = Y0 - by[k];
        const c = fx * fx + fy * fy - r2;
        let t;
        if (c <= 0) t = 0;
        else {
          if (a <= 1e-18) continue;
          const b = fx * dx + fy * dy;
          if (b >= 0) continue;
          const disc = b * b - a * c;
          if (disc < 0) continue;
          t = (-b - Math.sqrt(disc)) / a;
          if (t > 1) continue;
        }
        const az = bz[k] < 0 ? -bz[k] : bz[k];
        if (t < bestT - eps || (t <= bestT + eps && az < bestAz)) {
          // nowy najlepszy zaczyna okno remisu od siebie (wcześniejszy z remisu nie może wypaść poza nie)
          if (t < bestT) bestT = t;
          bestK = k; bestAz = az;
        }
      }
    }
  }
  if (bestK < 0) return -1;
  h.t = bestT; h.k = bestK; h.node = bi[bestK]; h.x = bx[bestK]; h.y = by[bestK]; h.z = bz[bestK];
  return h.node;
}

/**
 * Najbliższy (w XY) żywy węzeł pasa w promieniu `reach` od punktu (X, Y silnika) — wynik w bandHit, zwrot węzeł / −1.
 * Kolumna węzłów (ta sama XY w ćwierć komórki): wygrywa najbliższy płaszczyzny gry (jak bandSweep).
 */
export function bandProbe(body, X, Y, reach, halfH, now) {
  const h = bandHit;
  h.t = 0; h.node = -1; h.k = -1;
  if (!body || body.dead || body.activeNodes <= 0) return -1;
  const B = bandIndex(body, halfH, now);
  if (B.n === 0) return -1;
  const g = B.g, gx0 = B.gx0, gy0 = B.gy0, gnx = B.gnx, gny = B.gny;
  const x0 = Math.max(0, Math.floor((X - reach) / g) - gx0), x1 = Math.min(gnx - 1, Math.floor((X + reach) / g) - gx0);
  const y0 = Math.max(0, Math.floor((Y - reach) / g) - gy0), y1 = Math.min(gny - 1, Math.floor((Y + reach) / g) - gy0);
  if (x1 < x0 || y1 < y0) return -1;
  const heads = B.heads, next = B.next, bx = B.x, by = B.y, bz = B.z, bi = B.idx, active = body.nodeStore.active;
  let bestD2 = reach * reach, bestK = -1;
  for (let iy = y0; iy <= y1; iy++) {
    const rowBase = iy * gnx;
    for (let ix = x0; ix <= x1; ix++) {
      for (let k = heads[rowBase + ix]; k >= 0; k = next[k]) {
        if (!active[bi[k]]) continue;
        const ddx = bx[k] - X, ddy = by[k] - Y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 <= bestD2) { bestD2 = d2; bestK = k; }
      }
    }
  }
  if (bestK < 0) return -1;
  // remis kolumny: w ćwierć komórki od najbliższego — najbliżej płaszczyzny gry
  const lim = Math.min(reach, Math.sqrt(bestD2) + 0.25 * body.cellSize), lim2 = lim * lim;
  let bestAz = bz[bestK] < 0 ? -bz[bestK] : bz[bestK];
  for (let iy = y0; iy <= y1; iy++) {
    const rowBase = iy * gnx;
    for (let ix = x0; ix <= x1; ix++) {
      for (let k = heads[rowBase + ix]; k >= 0; k = next[k]) {
        if (!active[bi[k]]) continue;
        const az = bz[k] < 0 ? -bz[k] : bz[k];
        if (az >= bestAz) continue;
        const ddx = bx[k] - X, ddy = by[k] - Y;
        if (ddx * ddx + ddy * ddy <= lim2) { bestAz = az; bestK = k; }
      }
    }
  }
  h.k = bestK; h.node = bi[bestK]; h.x = bx[bestK]; h.y = by[bestK]; h.z = bz[bestK];
  return h.node;
}

/**
 * Węzły pasa w KAPSULE wokół odcinka (X0, Y0) → (X1, Y1) silnika, promień `reach`, posortowane po drodze wzdłuż
 * odcinka (wstawianie — kandydatów jest kilkadziesiąt): outI — węzły, outT — droga [j.] od (X0, Y0), outP — odległość
 * od osi. Najwyżej `cap`. Zwraca liczbę.
 */
export function bandCapsule(body, X0, Y0, X1, Y1, reach, halfH, now, outI, outT, outP, cap) {
  if (!body || body.dead || body.activeNodes <= 0) return 0;
  const B = bandIndex(body, halfH, now);
  if (B.n === 0) return 0;
  const dx = X1 - X0, dy = Y1 - Y0, len = Math.sqrt(dx * dx + dy * dy);
  if (!(len > 1e-9)) return 0;
  const ux = dx / len, uy = dy / len, reach2 = reach * reach;
  const g = B.g, gx0 = B.gx0, gy0 = B.gy0, gnx = B.gnx, gny = B.gny;
  const x0 = Math.max(0, Math.floor((Math.min(X0, X1) - reach) / g) - gx0);
  const x1 = Math.min(gnx - 1, Math.floor((Math.max(X0, X1) + reach) / g) - gx0);
  const y0 = Math.max(0, Math.floor((Math.min(Y0, Y1) - reach) / g) - gy0);
  const y1 = Math.min(gny - 1, Math.floor((Math.max(Y0, Y1) + reach) / g) - gy0);
  if (x1 < x0 || y1 < y0) return 0;
  const heads = B.heads, next = B.next, bx = B.x, by = B.y, bi = B.idx, active = body.nodeStore.active;
  let n = 0;
  for (let iy = y0; iy <= y1; iy++) {
    const rowBase = iy * gnx;
    for (let ix = x0; ix <= x1; ix++) {
      for (let k = heads[rowBase + ix]; k >= 0; k = next[k]) {
        if (!active[bi[k]]) continue;
        const ex = bx[k] - X0, ey = by[k] - Y0;
        const tt = ex * ux + ey * uy;
        if (tt < -reach || tt > len + reach) continue;
        const perp2 = ex * ex + ey * ey - tt * tt;
        if (perp2 > reach2) continue;
        if (n >= cap) return n;
        let at = n++;
        while (at > 0 && outT[at - 1] > tt) { outT[at] = outT[at - 1]; outI[at] = outI[at - 1]; outP[at] = outP[at - 1]; at--; }
        outT[at] = tt; outI[at] = bi[k]; outP[at] = Math.sqrt(Math.max(0, perp2));
      }
    }
  }
  return n;
}

/** Węzły pasa w kole (X, Y silnika, promień R w XY) — outI (najwyżej `cap`), zwraca liczbę. Bez sortowania. */
export function bandCircle(body, X, Y, R, halfH, now, outI, cap) {
  if (!body || body.dead || body.activeNodes <= 0) return 0;
  const B = bandIndex(body, halfH, now);
  if (B.n === 0) return 0;
  const g = B.g, gx0 = B.gx0, gy0 = B.gy0, gnx = B.gnx, gny = B.gny;
  const x0 = Math.max(0, Math.floor((X - R) / g) - gx0), x1 = Math.min(gnx - 1, Math.floor((X + R) / g) - gx0);
  const y0 = Math.max(0, Math.floor((Y - R) / g) - gy0), y1 = Math.min(gny - 1, Math.floor((Y + R) / g) - gy0);
  if (x1 < x0 || y1 < y0) return 0;
  const heads = B.heads, next = B.next, bx = B.x, by = B.y, bi = B.idx, active = body.nodeStore.active, R2 = R * R;
  let n = 0;
  for (let iy = y0; iy <= y1; iy++) {
    const rowBase = iy * gnx;
    for (let ix = x0; ix <= x1; ix++) {
      for (let k = heads[rowBase + ix]; k >= 0; k = next[k]) {
        if (!active[bi[k]]) continue;
        const ddx = bx[k] - X, ddy = by[k] - Y;
        if (ddx * ddx + ddy * ddy > R2) continue;
        if (n >= cap) return n;
        outI[n++] = bi[k];
      }
    }
  }
  return n;
}

// KLOCKI BRYŁY dla frontu fali (powłoka kuli przechodzi przez bryłę ~10 kroków, a kula bywa większa niż bryła — okno
// siatki obejmowałoby wtedy wszystkie węzły w każdym kroku): węzły ciała pogrupowane w klocki BRICK³ komórek
// kratownicy (ix, iy, iz), środek i promień klocka z pozycji SPOCZYNKOWYCH (ox, oy, oz — układ ciała). Bieżący węzeł
// leży najdalej `_maxDisp` od spoczynkowego w każdej osi (silnik liczy je względem ox), więc wołający poszerza promień
// klocka o √3 · (_maxDisp + komórka). Klocki żyją na ciele (`body._bricks`) do nowego magazynu węzłów.
const BRICK_SHIFT = 2;   // klocek 4 × 4 × 4 komórki

/**
 * Klocki bryły (budowane raz na magazyn węzłów): `n` niepustych klocków, węzły klocka k = nodes[start[k] … start[k+1]),
 * środek (cx, cy, cz) i promień r w układzie ciała (pozycje spoczynkowe).
 */
export function solidBricks(body) {
  const s = body.nodeStore;
  const br = body._bricks;
  if (br && br.store === s && br.count === s.count) return br;
  const d = body.dims;
  const nbx = (d.x + (1 << BRICK_SHIFT) - 1) >> BRICK_SHIFT, nby = (d.y + (1 << BRICK_SHIFT) - 1) >> BRICK_SHIFT;
  const nbz = (d.z + (1 << BRICK_SHIFT) - 1) >> BRICK_SHIFT, nbxy = nbx * nby, nb = nbxy * nbz;
  const ix = s.ix, iy = s.iy, iz = s.iz, count = s.count;
  const head = new Int32Array(nb + 1);
  for (let i = 0; i < count; i++) head[1 + (ix[i] >> BRICK_SHIFT) + (iy[i] >> BRICK_SHIFT) * nbx + (iz[i] >> BRICK_SHIFT) * nbxy]++;
  let n = 0;
  for (let b = 0; b < nb; b++) { if (head[b + 1] > 0) n++; head[b + 1] += head[b]; }
  const nodes = new Int32Array(count), fill = head.slice(0, nb);
  for (let i = 0; i < count; i++) nodes[fill[(ix[i] >> BRICK_SHIFT) + (iy[i] >> BRICK_SHIFT) * nbx + (iz[i] >> BRICK_SHIFT) * nbxy]++] = i;
  const start = new Int32Array(n + 1), cx = new Float64Array(n), cy = new Float64Array(n), cz = new Float64Array(n), r = new Float64Array(n);
  const ox = s.ox, oy = s.oy, oz = s.oz;
  let k = 0;
  for (let b = 0; b < nb; b++) {
    const a = head[b], e = head[b + 1];
    if (e === a) continue;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let j = a; j < e; j++) {
      const i = nodes[j];
      if (ox[i] < x0) x0 = ox[i]; if (ox[i] > x1) x1 = ox[i];
      if (oy[i] < y0) y0 = oy[i]; if (oy[i] > y1) y1 = oy[i];
      if (oz[i] < z0) z0 = oz[i]; if (oz[i] > z1) z1 = oz[i];
    }
    const mx = 0.5 * (x0 + x1), my = 0.5 * (y0 + y1), mz = 0.5 * (z0 + z1);
    let r2 = 0;
    for (let j = a; j < e; j++) {
      const i = nodes[j], qx = ox[i] - mx, qy = oy[i] - my, qz = oz[i] - mz, q2 = qx * qx + qy * qy + qz * qz;
      if (q2 > r2) r2 = q2;
    }
    start[k] = a; cx[k] = mx; cy[k] = my; cz[k] = mz; r[k] = Math.sqrt(r2);
    k++;
  }
  start[n] = count;
  return (body._bricks = { store: s, count, n, start, nodes, cx, cy, cz, r });
}

/**
 * Węzły ciała w oknie siatki spoczynkowej (3D) wokół punktu ciała (lx, ly, lz), promień `reach` + maks. przemieszczenie
 * węzła (jak _impactNodes silnika): `cells` — indeks komórka → węzeł (D._latticeIndex(body).cells), wynik w `out`
 * (tablica, czyszczona). Zwraca liczbę albo −1, gdy okno jest większe niż żywe węzły (przejrzyj wszystkie).
 */
export function latticeWindow3D(body, cells, lx, ly, lz, reach, out) {
  out.length = 0;
  const cs = body.cellSize, lm = body.latticeMin, d = body.dims;
  const pad = reach + (body._maxDisp || 0) + cs;
  const x0 = Math.max(0, Math.floor((lx - pad - lm.x) / cs - 0.5)), x1 = Math.min(d.x - 1, Math.ceil((lx + pad - lm.x) / cs - 0.5));
  const y0 = Math.max(0, Math.floor((ly - pad - lm.y) / cs - 0.5)), y1 = Math.min(d.y - 1, Math.ceil((ly + pad - lm.y) / cs - 0.5));
  const z0 = Math.max(0, Math.floor((lz - pad - lm.z) / cs - 0.5)), z1 = Math.min(d.z - 1, Math.ceil((lz + pad - lm.z) / cs - 0.5));
  if (x1 < x0 || y1 < y0 || z1 < z0) return 0;
  if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > body.activeNodes) return -1;
  const dxy = d.x * d.y;
  for (let zz = z0; zz <= z1; zz++) {
    for (let yy = y0; yy <= y1; yy++) {
      const row = yy * d.x + zz * dxy;
      for (let xx = x0; xx <= x1; xx++) {
        const i = cells[row + xx];
        if (i >= 0) out.push(i);
      }
    }
  }
  return out.length;
}
