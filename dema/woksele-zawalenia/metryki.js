// Metryki dema wiązanych wokseli (docs/SPEC-woksele-zawalenia.md § 8): liczone z pozycji i masek, te same dla wzorca CPU i odczytu z GPU.
// Moduł czysty: bez three, DOM i window. Port wspolne/metryki.mjs, metryk z wspolne/uruchom.mjs i analizy z spec-proby/scenyG.mjs.
// Wołane co 0,25 s czasu sceny albo rzadziej, więc mogą alokować krótkie bufory: nie są w pętli symulacji.
//
// Stan (WzorzecCpu albo odczyt GPU + wypiek): { n, pos, vel, aktywny, maskaW, szkoda, nbr, iN0, wa, wb, wd, mW }.
import { indeksyGrupy } from './scena.js';

function kosz(s) {
  return s < 2 ? 0 : s < 8 ? 1 : s < 64 ? 2 : s < 512 ? 3 : 4;
}

/** Popcount do 18 bitów dla metryk. */
function popc(x) {
  let c = 0;
  while (x) { x &= x - 1; c++; }
  return c;
}

/**
 * Wyspy spójne (union-find) po liście wiązań. Zwraca { aktywnych, liczbaWysp, najwieksza, udzial, hist, masa, etykiety }.
 * hist: liczba wysp w koszach rozmiaru 1 | 2–7 | 8–63 | 64–511 | 512+; masa: ile węzłów w tych koszach.
 */
export function wyspy(n, { maska = null, krawedzie, podzbior = null }) {
  const rodzic = new Int32Array(n);
  const aktywny = new Uint8Array(n);
  if (podzbior) {
    for (let q = 0; q < podzbior.length; q++) {
      const i = podzbior[q];
      if (!maska || maska[i]) aktywny[i] = 1;
    }
  } else {
    for (let i = 0; i < n; i++) aktywny[i] = !maska || maska[i] ? 1 : 0;
  }
  for (let i = 0; i < n; i++) rodzic[i] = i;
  const znajdz = (x) => {
    while (rodzic[x] !== x) {
      rodzic[x] = rodzic[rodzic[x]];
      x = rodzic[x];
    }
    return x;
  };
  const { a, b, aktywne = null } = krawedzie;
  const m = krawedzie.m ?? a.length;
  for (let e = 0; e < m; e++) {
    if (aktywne && !aktywne[e]) continue;
    const u = a[e], v = b[e];
    if (aktywny[u] && aktywny[v]) {
      const ra = znajdz(u), rb = znajdz(v);
      if (ra !== rb) rodzic[ra] = rb;
    }
  }
  const rozmiar = new Int32Array(n);
  const etykiety = new Int32Array(n).fill(-1);
  let aktywnych = 0;
  for (let i = 0; i < n; i++) {
    if (!aktywny[i]) continue;
    const r = znajdz(i);
    etykiety[i] = r;
    rozmiar[r]++;
    aktywnych++;
  }
  const hist = [0, 0, 0, 0, 0];
  const masa = [0, 0, 0, 0, 0];
  let najwieksza = 0, liczbaWysp = 0;
  for (let i = 0; i < n; i++) {
    const s = rozmiar[i];
    if (s === 0) continue;
    liczbaWysp++;
    if (s > najwieksza) najwieksza = s;
    const k = kosz(s);
    hist[k]++;
    masa[k] += s;
  }
  return { aktywnych, liczbaWysp, najwieksza, udzial: aktywnych ? najwieksza / aktywnych : 0, hist, masa, etykiety };
}

/** Wysokość dachu: percentyl (domyślnie 95) współrzędnej z żywych węzłów. */
export function wysokoscDachu(pos, n, { maska = null, podzbior = null, percentyl = 95 } = {}) {
  const m = podzbior ? podzbior.length : n;
  const z = new Float32Array(m);
  let c = 0;
  for (let q = 0; q < m; q++) {
    const i = podzbior ? podzbior[q] : q;
    if (maska && !maska[i]) continue;
    const v = pos[3 * i + 2];
    if (v === v) z[c++] = v;
  }
  if (c === 0) return NaN;
  const uz = z.subarray(0, c);
  uz.sort();
  return uz[Math.min(c - 1, Math.floor((percentyl / 100) * c))];
}

/** Środek masy żywych węzłów (masy równe). */
export function srodekMasy(pos, n, { maska = null, podzbior = null } = {}) {
  const m = podzbior ? podzbior.length : n;
  let x = 0, y = 0, z = 0, c = 0;
  for (let q = 0; q < m; q++) {
    const i = podzbior ? podzbior[q] : q;
    if (maska && !maska[i]) continue;
    const a = pos[3 * i], b = pos[3 * i + 1], d = pos[3 * i + 2];
    if (!(a === a && b === b && d === d)) continue;
    x += a; y += b; z += d; c++;
  }
  return c ? [x / c, y / c, z / c] : [NaN, NaN, NaN];
}

/** Indeksy górnej części: węzły o początkowym z w górnym `ulamek` zakresu z. */
export function indeksyGorne(pos0, podzbior, ulamek = 0.3) {
  let zMin = Infinity, zMax = -Infinity;
  for (let q = 0; q < podzbior.length; q++) {
    const z = pos0[3 * podzbior[q] + 2];
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  const prog = zMax - ulamek * (zMax - zMin);
  const out = [];
  for (let q = 0; q < podzbior.length; q++) if (pos0[3 * podzbior[q] + 2] >= prog) out.push(podzbior[q]);
  return Int32Array.from(out);
}

/** Wartości i wektory własne symetrycznej 3×3 (Jacobi). C: [xx,xy,xz,yy,yz,zz]. Malejąco. */
function wlasne3(C) {
  const a = [[C[0], C[1], C[2]], [C[1], C[3], C[4]], [C[2], C[4], C[5]]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let it = 0; it < 24; it++) {
    let p = 0, q = 1;
    let mx = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > mx) { mx = Math.abs(a[0][2]); p = 0; q = 2; }
    if (Math.abs(a[1][2]) > mx) { mx = Math.abs(a[1][2]); p = 1; q = 2; }
    if (mx < 1e-12) break;
    const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(th), s = Math.sin(th);
    for (let k = 0; k < 3; k++) {
      const ap = a[k][p], aq = a[k][q];
      a[k][p] = c * ap - s * aq;
      a[k][q] = s * ap + c * aq;
    }
    for (let k = 0; k < 3; k++) {
      const pa = a[p][k], qa = a[q][k];
      a[p][k] = c * pa - s * qa;
      a[q][k] = s * pa + c * qa;
    }
    for (let k = 0; k < 3; k++) {
      const vp = v[k][p], vq = v[k][q];
      v[k][p] = c * vp - s * vq;
      v[k][q] = s * vp + c * vq;
    }
  }
  const pary = [0, 1, 2].map((i) => ({ l: a[i][i], w: [v[0][i], v[1][i], v[2][i]] }));
  pary.sort((x, y) => y.l - x.l);
  return { lam: pary.map((x) => x.l), wek: pary.map((x) => x.w) };
}

/**
 * Przechył masy `idx` względem stanu początkowego (Kabsch).
 * sztywnyStopnie: kąt obrotu osi z w najlepiej dopasowanym obrocie sztywnym; reszta: RMS po dopasowaniu (j.), resztaDx: to samo w dx.
 * Mała reszta to bryła w ruchu sztywnym, duża to masa, która się zgniata.
 */
export function przechyl(pos, pos0, idx, { maska = null, dx = 0 } = {}) {
  let c = 0, mx = 0, my = 0, mz = 0, m0x = 0, m0y = 0, m0z = 0;
  for (let q = 0; q < idx.length; q++) {
    const i = idx[q];
    if (maska && !maska[i]) continue;
    const a = pos[3 * i], b = pos[3 * i + 1], d = pos[3 * i + 2];
    if (!(a === a && b === b && d === d)) continue;
    mx += a; my += b; mz += d;
    m0x += pos0[3 * i]; m0y += pos0[3 * i + 1]; m0z += pos0[3 * i + 2];
    c++;
  }
  if (c < 8) return { pcaStopnie: NaN, pcaWydluzenie: NaN, sztywnyStopnie: NaN, kierunekStopnie: NaN, reszta: NaN, resztaDx: NaN, wokseli: c };
  mx /= c; my /= c; mz /= c; m0x /= c; m0y /= c; m0z /= c;
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let q = 0; q < idx.length; q++) {
    const i = idx[q];
    if (maska && !maska[i]) continue;
    const a = pos[3 * i] - mx, b = pos[3 * i + 1] - my, d = pos[3 * i + 2] - mz;
    if (!(a === a && b === b && d === d)) continue;
    const e = pos0[3 * i] - m0x, f = pos0[3 * i + 1] - m0y, g = pos0[3 * i + 2] - m0z;
    xx += a * a; xy += a * b; xz += a * d; yy += b * b; yz += b * d; zz += d * d;
    A[0] += a * e; A[1] += a * f; A[2] += a * g;
    A[3] += b * e; A[4] += b * f; A[5] += b * g;
    A[6] += d * e; A[7] += d * f; A[8] += d * g;
  }
  const { lam, wek } = wlasne3([xx / c, xy / c, xz / c, yy / c, yz / c, zz / c]);
  const pcaStopnie = (Math.acos(Math.min(1, Math.abs(wek[0][2]))) * 180) / Math.PI;
  const pcaWydluzenie = lam[1] > 1e-9 ? lam[0] / lam[1] : Infinity;
  // Najlepszy obrót właściwy z dwóch największych wartości osobliwych A = U S Vᵀ, liczonych przez AᵀA:
  // R = u1 v1ᵀ + u2 v2ᵀ + (u1 × u2)(v1 × v2)ᵀ. Działa też dla masy spłaszczonej i nie daje odbicia lustrzanego.
  let norma = 0;
  for (let k = 0; k < 9; k++) norma += A[k] * A[k];
  norma = Math.sqrt(norma / 3) || 1;
  const B = A.map((x) => x / norma);
  const ata = [
    B[0] * B[0] + B[3] * B[3] + B[6] * B[6],
    B[0] * B[1] + B[3] * B[4] + B[6] * B[7],
    B[0] * B[2] + B[3] * B[5] + B[6] * B[8],
    B[1] * B[1] + B[4] * B[4] + B[7] * B[7],
    B[1] * B[2] + B[4] * B[5] + B[7] * B[8],
    B[2] * B[2] + B[5] * B[5] + B[8] * B[8],
  ];
  const sv = wlasne3(ata);
  const s1 = Math.sqrt(Math.max(0, sv.lam[0]));
  const s2 = Math.sqrt(Math.max(0, sv.lam[1]));
  if (!(s2 > 1e-6 * s1) || !(s1 > 0)) {
    return { pcaStopnie, pcaWydluzenie, sztywnyStopnie: NaN, kierunekStopnie: NaN, reszta: NaN, resztaDx: NaN, wokseli: c };
  }
  const [v1, v2] = sv.wek;
  const zaA = (w, sk) => [
    (B[0] * w[0] + B[1] * w[1] + B[2] * w[2]) / sk,
    (B[3] * w[0] + B[4] * w[1] + B[5] * w[2]) / sk,
    (B[6] * w[0] + B[7] * w[1] + B[8] * w[2]) / sk,
  ];
  const wekt = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const u1 = zaA(v1, s1);
  const u2 = zaA(v2, s2);
  const u3 = wekt(u1, u2);
  const v3 = wekt(v1, v2);
  const R = new Array(9);
  for (let w = 0; w < 3; w++) {
    for (let k = 0; k < 3; k++) R[3 * w + k] = u1[w] * v1[k] + u2[w] * v2[k] + u3[w] * v3[k];
  }
  // R mapuje p0 − c0 na p − c. Oś z po obrocie = trzecia kolumna.
  const zx = R[2], zy = R[5], zzz = R[8];
  const sztywnyStopnie = (Math.acos(Math.max(-1, Math.min(1, zzz))) * 180) / Math.PI;
  const kierunekStopnie = (Math.atan2(zy, zx) * 180) / Math.PI;
  let r2 = 0;
  for (let q = 0; q < idx.length; q++) {
    const i = idx[q];
    if (maska && !maska[i]) continue;
    const a = pos[3 * i] - mx, b = pos[3 * i + 1] - my, d = pos[3 * i + 2] - mz;
    if (!(a === a && b === b && d === d)) continue;
    const e = pos0[3 * i] - m0x, f = pos0[3 * i + 1] - m0y, g = pos0[3 * i + 2] - m0z;
    const ex = a - (R[0] * e + R[1] * f + R[2] * g);
    const ey = b - (R[3] * e + R[4] * f + R[5] * g);
    const ez = d - (R[6] * e + R[7] * f + R[8] * g);
    r2 += ex * ex + ey * ey + ez * ez;
  }
  const reszta = Math.sqrt(r2 / c);
  return { pcaStopnie, pcaWydluzenie, sztywnyStopnie, kierunekStopnie, reszta, resztaDx: dx > 0 ? reszta / dx : NaN, wokseli: c };
}

/** Prędkość średnia po węzłach z różnicy dwóch stanów. */
export function predkoscSrednia(pos, posPoprz, dt, idx, { maska = null } = {}) {
  let vx = 0, vy = 0, vz = 0, v2 = 0, c = 0;
  const m = idx.length;
  for (let q = 0; q < m; q++) {
    const i = idx[q];
    if (maska && !maska[i]) continue;
    const a = (pos[3 * i] - posPoprz[3 * i]) / dt;
    const b = (pos[3 * i + 1] - posPoprz[3 * i + 1]) / dt;
    const d = (pos[3 * i + 2] - posPoprz[3 * i + 2]) / dt;
    if (!(a === a && b === b && d === d)) continue;
    vx += a; vy += b; vz += d;
    v2 += a * a + b * b + d * d;
    c++;
  }
  if (!c) return { vx: NaN, vy: NaN, vz: NaN, vRms: NaN, wokseli: 0 };
  return { vx: vx / c, vy: vy / c, vz: vz / c, vRms: Math.sqrt(v2 / c), wokseli: c };
}

/** Przemieszczenia od stanu początkowego: { max, srednie, udzialPonad, opad (średnie Δz w warstwie `gorne`) }. */
export function przemieszczenia(pos, pos0, idx, { maska = null, prog = Infinity, gorne = null } = {}) {
  let max = 0, sum = 0, c = 0, pon = 0;
  const p2 = prog === Infinity ? Infinity : prog * prog;
  for (let q = 0; q < idx.length; q++) {
    const i = idx[q];
    if (maska && !maska[i]) continue;
    const a = pos[3 * i] - pos0[3 * i], b = pos[3 * i + 1] - pos0[3 * i + 1], d = pos[3 * i + 2] - pos0[3 * i + 2];
    if (!(a === a && b === b && d === d)) continue;
    const r2 = a * a + b * b + d * d;
    if (r2 > max) max = r2;
    sum += Math.sqrt(r2);
    if (r2 > p2) pon++;
    c++;
  }
  let opad = NaN;
  if (gorne) {
    let s = 0, g = 0;
    for (let q = 0; q < gorne.length; q++) {
      const i = gorne[q];
      if (maska && !maska[i]) continue;
      const d = pos[3 * i + 2] - pos0[3 * i + 2];
      if (d === d) { s += d; g++; }
    }
    if (g) opad = s / g;
  }
  return { max: Math.sqrt(max), srednie: c ? sum / c : 0, udzialPonad: c ? pon / c : 0, opad };
}

/** Rzut początkowy dysku (raz), potem poleOtworu. Komórka XY pusta: była zajęta, a teraz nie ma w niej węzła dysku o |z − zSrodek| ≤ margines. */
export function przygotujOtwor(pos0, idx, { dx, zSrodek = 0, margines = null } = {}) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let q = 0; q < idx.length; q++) {
    const i = idx[q];
    if (pos0[3 * i] < x0) x0 = pos0[3 * i];
    if (pos0[3 * i] > x1) x1 = pos0[3 * i];
    if (pos0[3 * i + 1] < y0) y0 = pos0[3 * i + 1];
    if (pos0[3 * i + 1] > y1) y1 = pos0[3 * i + 1];
  }
  const nx = Math.ceil((x1 - x0) / dx) + 1;
  const ny = Math.ceil((y1 - y0) / dx) + 1;
  const pelne = new Uint8Array(nx * ny);
  for (let q = 0; q < idx.length; q++) {
    const i = idx[q];
    const a = Math.round((pos0[3 * i] - x0) / dx);
    const b = Math.round((pos0[3 * i + 1] - y0) / dx);
    pelne[b * nx + a] = 1;
  }
  let pelnych = 0;
  for (let i = 0; i < pelne.length; i++) pelnych += pelne[i];
  return { x0, y0, nx, ny, dx, zSrodek, margines: margines ?? 3 * dx, idx, pelne, pelnych, teraz: new Uint8Array(nx * ny), stos: new Int32Array(nx * ny) };
}

/** { pole, poleGlowne, srodekGlownego, promienRownowazny, polePelne } (j.²); poleGlowne = największa spójna pusta plama. */
export function poleOtworu(stan, pos, maska = null) {
  const { x0, y0, nx, ny, dx, zSrodek, margines, idx, pelne, teraz, stos } = stan;
  teraz.fill(0);
  for (let q = 0; q < idx.length; q++) {
    const i = idx[q];
    if (maska && !maska[i]) continue;
    const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
    if (!(Math.abs(z - zSrodek) <= margines)) continue;
    const a = Math.round((x - x0) / dx), b = Math.round((y - y0) / dx);
    if (a >= 0 && b >= 0 && a < nx && b < ny) teraz[b * nx + a] = 1;
  }
  // 1 w `teraz` = zajęta; 2 = pusta odwiedzona.
  let puste = 0, glowna = 0, gx = 0, gy = 0;
  const N = nx * ny;
  for (let s = 0; s < N; s++) {
    if (!pelne[s] || teraz[s]) continue;
    let top = 0;
    stos[top++] = s;
    teraz[s] = 2;
    let roz = 0, sx = 0, sy = 0;
    while (top > 0) {
      const c = stos[--top];
      roz++;
      const a = c % nx, b = (c - a) / nx;
      sx += a;
      sy += b;
      if (a > 0 && pelne[c - 1] && !teraz[c - 1]) { teraz[c - 1] = 2; stos[top++] = c - 1; }
      if (a < nx - 1 && pelne[c + 1] && !teraz[c + 1]) { teraz[c + 1] = 2; stos[top++] = c + 1; }
      if (b > 0 && pelne[c - nx] && !teraz[c - nx]) { teraz[c - nx] = 2; stos[top++] = c - nx; }
      if (b < ny - 1 && pelne[c + nx] && !teraz[c + nx]) { teraz[c + nx] = 2; stos[top++] = c + nx; }
    }
    puste += roz;
    if (roz > glowna) {
      glowna = roz;
      gx = x0 + (sx / roz) * dx;
      gy = y0 + (sy / roz) * dx;
    }
  }
  const pole = puste * dx * dx;
  const poleGlowne = glowna * dx * dx;
  return { pole, poleGlowne, srodekGlownego: [gx, gy], promienRownowazny: Math.sqrt(poleGlowne / Math.PI), polePelne: stan.pelnych * dx * dx };
}

/** Część węzłów `idx`, które ruszyły się dalej niż prog; usunięty liczy się jako ruszony. */
export function udzialRuszonych(pos, pos0, idx, prog, maska = null) {
  let c = 0, r = 0;
  const p2 = prog * prog;
  for (let q = 0; q < idx.length; q++) {
    const i = idx[q];
    if (maska && !maska[i]) { r++; c++; continue; }
    const a = pos[3 * i] - pos0[3 * i], b = pos[3 * i + 1] - pos0[3 * i + 1], d = pos[3 * i + 2] - pos0[3 * i + 2];
    if (a * a + b * b + d * d > p2) r++;
    c++;
  }
  return c ? r / c : 0;
}

/** Zaokrąglenie do 4 miejsc i null zamiast nieskończoności przy zapisie JSON. */
export function zastapLiczby(k, v) {
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  if (typeof v === 'number') return Number(v.toFixed(4));
  return v;
}

function wiazaniaStanu(stan) {
  if (typeof stan.wiazania === 'function') return stan.wiazania();
  const { wa, wb, wd, mW, maskaW } = stan;
  const aktywne = new Uint8Array(mW);
  for (let e = 0; e < mW; e++) aktywne[e] = (maskaW[wa[e]] >>> wd[e]) & 1;
  return { a: wa, b: wb, m: mW, aktywne };
}

function metrykiChwili(a) {
  const { t, stan, pos0, posPoprz, n, dx, tWieza, tDysk, gorne, warstwaDachu, usunieto, s3, stanOtworu } = a;
  const pos = stan.pos, maska = stan.aktywny;
  let nan = 0;
  for (let i = 0; i < 3 * n; i++) if (pos[i] !== pos[i]) nan++;
  let aktywnych = 0;
  for (let i = 0; i < n; i++) aktywnych += maska[i] ? 1 : 0;
  const krawedzie = wiazaniaStanu(stan);
  const wyspyWiezy = wyspy(n, { maska, krawedzie, podzbior: tWieza });
  const wpis = {
    t,
    aktywnych,
    usunieto,
    nan,
    wieza: {
      dach: wysokoscDachu(pos, n, { maska, podzbior: tWieza }),
      srodekMasy: srodekMasy(pos, n, { maska, podzbior: tWieza }),
      przechyl: przechyl(pos, pos0, gorne, { maska, dx }),
      przechylCalosci: przechyl(pos, pos0, tWieza, { maska, dx }),
      ruch: przemieszczenia(pos, pos0, tWieza, { maska, prog: dx, gorne: warstwaDachu }),
      v: predkoscSrednia(pos, posPoprz, 1 / 60, tWieza, { maska }),
      wyspy: { liczba: wyspyWiezy.liczbaWysp, udzial: wyspyWiezy.udzial, najwieksza: wyspyWiezy.najwieksza, hist: wyspyWiezy.hist, masa: wyspyWiezy.masa },
    },
    model: typeof stan.statystyki === 'function' ? stan.statystyki() : null,
  };
  if (s3) {
    const wyspyDysku = wyspy(n, { maska, krawedzie, podzbior: tDysk });
    const otw = poleOtworu(stanOtworu, pos, maska);
    wpis.dysk = {
      otwor: otw,
      otworDoPrzekroju: otw.poleGlowne / s3.przekroj,
      udzialRuszonych: udzialRuszonych(pos, pos0, tDysk, dx, maska),
      wyspy: { liczba: wyspyDysku.liczbaWysp, udzial: wyspyDysku.udzial, najwieksza: wyspyDysku.najwieksza, hist: wyspyDysku.hist, masa: wyspyDysku.masa },
    };
  }
  return wpis;
}

function sledzPrzebicie(st, s3, t, pos, posPoprz, dt, tWieza, maska, dx, g) {
  // Kontakt: najniższy węzeł wieży schodzi do pokładu. Prędkość średnia po całej wieży.
  let minZ = Infinity, ponizej = 0, wszystkich = 0, sumaVpon = 0;
  let sumaV = 0;
  for (let q = 0; q < tWieza.length; q++) {
    const i = tWieza[q];
    if (!maska[i]) continue;
    const z = pos[3 * i + 2];
    if (z < minZ) minZ = z;
    wszystkich++;
    if (t > 0) {
      const vz = (z - posPoprz[3 * i + 2]) / dt;
      sumaV += vz;
      if (z < s3.zDol - dx) {
        ponizej++;
        sumaVpon += vz;
      }
    }
  }
  if (minZ < st.minZWiezy) st.minZWiezy = minZ;
  if (t === 0 || wszystkich === 0) return;
  const srV = sumaV / wszystkich;
  if (st.tKontakt === null && minZ <= s3.zGora + dx) {
    st.tKontakt = t;
    st.vPrzed = srV; // < 0 w dół
  }
  if (st.tKontakt !== null && st.tPrzejscie === null && ponizej >= 0.5 * wszystkich) {
    st.tPrzejscie = t;
    st.vPo = sumaVpon / ponizej;
    st.vSwobodnaPo = -(s3.v0 + g * t);
  }
  st.vKoniec = srV;
}

/**
 * Obserwator przebiegu sceny: dziennik co 0,25 s, W1, śledzenie S3, przechył spójny. Ten sam dla Node i odczytu z GPU (§ 8).
 * Użycie: new ObserwatorSceny(plan); dla f = 0…N: klatka(f, stan) przed zdarzeniami klatki f; po pętli koniec(stan).
 */
export class ObserwatorSceny {
  constructor(plan) {
    this.plan = plan;
    const sc = plan.scena;
    this.n = sc.n;
    this.dx = sc.dx;
    this.N = Math.round(plan.T * 60);
    this.pos0 = sc.pos.slice();
    this.posPoprz = sc.pos.slice();
    this.tWieza = indeksyGrupy(sc, 'wieza');
    this.tDysk = indeksyGrupy(sc, 'dysk');
    this.gorne = indeksyGorne(this.pos0, this.tWieza, 0.3);
    this.warstwaDachu = indeksyGorne(this.pos0, this.tWieza, 0.05);
    this.s3 = plan.s3 ?? null;
    this.stanOtworu = this.s3 ? przygotujOtwor(this.pos0, this.tDysk, { dx: this.dx, zSrodek: this.s3.zSrodek }) : null;
    this.sledzS3 = { tKontakt: null, vPrzed: null, tPrzejscie: null, vPo: null, vSwobodnaPo: null, vKoniec: null, minZWiezy: Infinity };
    this.podsW1 = {};
    this.historia = { maxPrzechyl: 0, tMaxPrzechyl: 0, maxPrzechylSpojny: 0, tMaxPrzechylSpojny: 0, maxPrzechylCalosciSpojny: 0 };
    this.przedZdarzeniem = { maxPrzem: 0, vRmsMaxPo1s: 0 };
    this.wpisy = [];
    this.usunieto = 0;
    this.klatek = 0;
  }

  _metryki(t, stan) {
    return metrykiChwili({
      t, stan, pos0: this.pos0, posPoprz: this.posPoprz, n: this.n, dx: this.dx, tWieza: this.tWieza, tDysk: this.tDysk,
      gorne: this.gorne, warstwaDachu: this.warstwaDachu, usunieto: this.usunieto, s3: this.s3, stanOtworu: this.stanOtworu,
    });
  }

  /** Przed zdarzeniami klatki f. Zwraca wpis dziennika, jeśli tej klatki powstał. */
  klatka(f, stan) {
    const t = f / 60;
    const czyLog = f % 15 === 0 || f === this.N;
    const zo = this.plan.zdarzeniaOd;
    const czyW1 = Number.isFinite(zo) && f === Math.max(0, Math.ceil(zo * 60) - 1);
    let wpis = null;
    if (czyLog || czyW1) {
      wpis = this._metryki(t, stan);
      if (czyLog) this.wpisy.push(wpis);
      if (czyW1) {
        this.podsW1.t = t;
        this.podsW1.maxPrzemieszczenie = wpis.wieza.ruch.max;
        this.podsW1.opadDachu = wpis.wieza.ruch.opad;
        this.podsW1.vRms = wpis.wieza.v.vRms;
        this.podsW1.dachu = wpis.wieza.dach;
        this.podsW1.przechylSztywny = wpis.wieza.przechyl.sztywnyStopnie;
      }
      const prz = wpis.wieza.przechyl;
      const h = this.historia;
      if (prz.sztywnyStopnie > h.maxPrzechyl) { h.maxPrzechyl = prz.sztywnyStopnie; h.tMaxPrzechyl = t; }
      // Przechył „w całości”: kąt liczy się tylko, póki górna masa trzyma kształt (reszta < 1,5 dx).
      if (prz.resztaDx < 1.5 && prz.sztywnyStopnie > h.maxPrzechylSpojny) { h.maxPrzechylSpojny = prz.sztywnyStopnie; h.tMaxPrzechylSpojny = t; }
      const calosc = wpis.wieza.przechylCalosci;
      if (calosc.resztaDx < 1.5 && calosc.sztywnyStopnie > h.maxPrzechylCalosciSpojny) h.maxPrzechylCalosciSpojny = calosc.sztywnyStopnie;
      if (t < zo) {
        if (wpis.wieza.ruch.max > this.przedZdarzeniem.maxPrzem) this.przedZdarzeniem.maxPrzem = wpis.wieza.ruch.max;
        if (t >= 1 && wpis.wieza.v.vRms > this.przedZdarzeniem.vRmsMaxPo1s) this.przedZdarzeniem.vRmsMaxPo1s = wpis.wieza.v.vRms;
      }
    }
    if (f !== this.N) {
      if (this.s3) sledzPrzebicie(this.sledzS3, this.s3, t, stan.pos, this.posPoprz, 1 / 60, this.tWieza, stan.aktywny, this.dx, this.plan.g);
      this.posPoprz.set(stan.pos);
      this.klatek = f + 1;
    }
    return wpis;
  }

  /** Dolicza usunięte węzły (wynik plan.zdarzenia). */
  dodajUsuniete(ile) { this.usunieto += ile; }

  /** Podsumowanie po ostatniej klatce. */
  koniec(stan) {
    const koniec = this._metryki(this.klatek / 60, stan);
    const zo = this.plan.zdarzeniaOd;
    const s3 = this.sledzS3;
    return {
      scena: this.plan.id,
      dx: this.dx,
      n: this.n,
      tOsiagniete: this.klatek / 60,
      usunieto: this.usunieto,
      W1: Number.isFinite(zo) ? { ...this.podsW1, ...this.przedZdarzeniem } : null,
      historia: this.historia,
      koniec,
      S3: this.s3 ? { ...s3, stosunekV: s3.vPo !== null && s3.vSwobodnaPo ? s3.vPo / s3.vSwobodnaPo : null } : null,
    };
  }

  /** Dziennik po zaokrągleniu do 4 miejsc, jak zapisywał prototyp (log-R7 liczy z tego). */
  dziennik() {
    return JSON.parse(JSON.stringify(this.wpisy, zastapLiczby));
  }
}

/**
 * Płyty stropów (metryka „taca” z § 1.3, § 7, § 8): na każde piętro procent największego kawałka płyty z żywych wiązań w tej płycie.
 * Wynik od najniższej do dachu (ostatni). Przygotowanie raz na scenę: pietraStropow(scena).
 */
export function pietraStropow(scena) {
  const { n, kind, ijk } = scena;
  const ks = [...new Set(Array.from({ length: n }, (_, i) => (kind[i] === 0 ? ijk[3 * i + 2] : -1)))].filter((q) => q >= 0).sort((a, b) => a - b);
  const pietra = [];
  for (let q = 0; q < ks.length; q += 2) pietra.push([ks[q], ks[q + 1] ?? ks[q]]);
  const nale = new Int16Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (kind[i] !== 0) continue;
    const k = ijk[3 * i + 2];
    for (let p = 0; p < pietra.length; p++) if (k === pietra[p][0] || k === pietra[p][1]) nale[i] = p;
  }
  return { pietra, nale };
}

export function taca(stan, pp) {
  const { pietra, nale } = pp;
  const { n, aktywny, maskaW, nbr } = stan;
  const rodz = new Int32Array(n);
  for (let i = 0; i < n; i++) rodz[i] = i;
  const zn = (a) => { while (rodz[a] !== a) { rodz[a] = rodz[rodz[a]]; a = rodz[a]; } return a; };
  for (let i = 0; i < n; i++) {
    if (nale[i] < 0 || !aktywny[i]) continue;
    for (let d = 0; d < 18; d++) {
      if ((maskaW[i] >>> d) & 1) {
        const j = nbr[18 * i + d];
        if (nale[j] === nale[i] && aktywny[j]) {
          const a = zn(i), b = zn(j);
          if (a !== b) rodz[a] = b;
        }
      }
    }
  }
  const raport = [];
  for (let p = 0; p < pietra.length; p++) {
    const roz = new Map();
    let wsz = 0;
    for (let i = 0; i < n; i++) {
      if (nale[i] === p && aktywny[i]) {
        const a = zn(i);
        roz.set(a, (roz.get(a) ?? 0) + 1);
        wsz++;
      }
    }
    const mx = Math.max(0, ...roz.values());
    raport.push(Math.round((100 * mx) / Math.max(1, wsz)));
  }
  return raport;
}

function polar(A) {
  const R = Float64Array.from(A);
  for (let it = 0; it < 30; it++) {
    const a = R[0], b = R[1], c = R[2], d = R[3], e = R[4], f = R[5], g = R[6], h = R[7], i = R[8];
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (Math.abs(det) < 1e-12) break;
    const id = 1 / det;
    // odwrotność transponowanej
    const T = [(e * i - f * h) * id, (f * g - d * i) * id, (d * h - e * g) * id, (c * h - b * i) * id, (a * i - c * g) * id, (b * g - a * h) * id, (b * f - c * e) * id, (c * d - a * f) * id, (a * e - b * d) * id];
    let zm = 0;
    for (let q = 0; q < 9; q++) { const n = 0.5 * (R[q] + T[q]); zm += Math.abs(n - R[q]); R[q] = n; }
    if (zm < 1e-10) break;
  }
  return R;
}

/** Analiza połówek po cięciu (§ 10.6): pęd, moment pędu, kawałki z żywych wiązań, dopasowanie sztywne. */
export function analizaPolowek(stan, pos0, zc, pasmoStrefy) {
  const { n, pos, vel, aktywny, nbr, maskaW: maska, iN0 } = stan;
  let N = 0, Px = 0, Py = 0, Pz = 0, cx = 0, cy = 0, cz = 0, Ek = 0;
  for (let i = 0; i < n; i++) {
    if (!aktywny[i]) continue;
    N++;
    Px += vel[3 * i]; Py += vel[3 * i + 1]; Pz += vel[3 * i + 2];
    cx += pos[3 * i]; cy += pos[3 * i + 1]; cz += pos[3 * i + 2];
    Ek += 0.5 * (vel[3 * i] ** 2 + vel[3 * i + 1] ** 2 + vel[3 * i + 2] ** 2);
  }
  cx /= N; cy /= N; cz /= N;
  let Lx = 0, Ly = 0, Lz = 0;
  for (let i = 0; i < n; i++) {
    if (!aktywny[i]) continue;
    const X = pos[3 * i] - cx, Y = pos[3 * i + 1] - cy, Z = pos[3 * i + 2] - cz;
    const vx = vel[3 * i], vy = vel[3 * i + 1], vz = vel[3 * i + 2];
    Lx += Y * vz - Z * vy; Ly += Z * vx - X * vz; Lz += X * vy - Y * vx;
  }
  const rodz = new Int32Array(n);
  for (let i = 0; i < n; i++) rodz[i] = i;
  const zn = (a) => { while (rodz[a] !== a) { rodz[a] = rodz[rodz[a]]; a = rodz[a]; } return a; };
  for (let i = 0; i < n; i++) {
    if (!aktywny[i]) continue;
    let mk = maska[i] & 0x3ffff;
    while (mk) {
      const b = mk & -mk;
      mk ^= b;
      const d = 31 - Math.clz32(b);
      const j = nbr[18 * i + d];
      if (j >= 0) {
        const a = zn(i), c = zn(j);
        if (a !== c) rodz[a] = c;
      }
    }
  }
  const roz = new Map();
  for (let i = 0; i < n; i++) if (aktywny[i]) { const a = zn(i); roz.set(a, (roz.get(a) ?? 0) + 1); }
  const kosze = [0, 0, 0, 0, 0];
  for (const v of roz.values()) kosze[kosz(v)] += v;

  const polowa = (znak) => {
    const idx = [];
    for (let i = 0; i < n; i++) {
      if (!aktywny[i]) continue;
      const d = pos0[3 * i + 2] - zc;
      if (znak * d > 0) idx.push(i);
    }
    const poza = idx.filter((i) => Math.abs(pos0[3 * i + 2] - zc) > pasmoStrefy);
    // największy kawałek połowy
    const lk = new Map();
    for (const i of idx) { const a = zn(i); lk.set(a, (lk.get(a) ?? 0) + 1); }
    let aMax = -1, nMax = 0;
    for (const [a, v] of lk) if (v > nMax) { nMax = v; aMax = a; }
    const cale = idx.filter((i) => zn(i) === aMax);
    const oderwPoza = poza.filter((i) => zn(i) !== aMax).length;
    let strat = 0;
    for (const i of poza) {
      const l = popc(maska[i] & 0x3ffff);
      if (1 - l * iN0[i] > 1e-6) strat++;
    }
    let vx = 0, vy = 0, vz = 0, x = 0, y = 0, z = 0, x0 = 0, y0 = 0, z0 = 0;
    for (const i of cale) {
      vx += vel[3 * i]; vy += vel[3 * i + 1]; vz += vel[3 * i + 2];
      x += pos[3 * i]; y += pos[3 * i + 1]; z += pos[3 * i + 2];
      x0 += pos0[3 * i]; y0 += pos0[3 * i + 1]; z0 += pos0[3 * i + 2];
    }
    const c = cale.length || 1;
    vx /= c; vy /= c; vz /= c; x /= c; y /= c; z /= c; x0 /= c; y0 /= c; z0 /= c;
    // Moment pędu własny i tensor bezwładności → ω
    let lx = 0, ly = 0, lz = 0, Ixx = 0, Iyy = 0, Izz = 0, Ixy = 0, Ixz = 0, Iyz = 0;
    const A = new Float64Array(9);
    for (const i of cale) {
      const X = pos[3 * i] - x, Y = pos[3 * i + 1] - y, Z = pos[3 * i + 2] - z;
      const ux = vel[3 * i] - vx, uy = vel[3 * i + 1] - vy, uz = vel[3 * i + 2] - vz;
      lx += Y * uz - Z * uy; ly += Z * ux - X * uz; lz += X * uy - Y * ux;
      Ixx += Y * Y + Z * Z; Iyy += X * X + Z * Z; Izz += X * X + Y * Y;
      Ixy -= X * Y; Ixz -= X * Z; Iyz -= Y * Z;
      const X0 = pos0[3 * i] - x0, Y0 = pos0[3 * i + 1] - y0, Z0 = pos0[3 * i + 2] - z0;
      A[0] += X * X0; A[1] += X * Y0; A[2] += X * Z0; A[3] += Y * X0; A[4] += Y * Y0; A[5] += Y * Z0; A[6] += Z * X0; A[7] += Z * Y0; A[8] += Z * Z0;
    }
    const Ai = Iyy * Izz - Iyz * Iyz, Bi = Ixz * Iyz - Ixy * Izz, Ci = Ixy * Iyz - Ixz * Iyy;
    const det = Ixx * Ai + Ixy * Bi + Ixz * Ci;
    let wx = 0, wy = 0, wz = 0;
    if (Math.abs(det) > 1e-6) {
      const Ei = Ixx * Izz - Ixz * Ixz, Fi = Ixy * Ixz - Ixx * Iyz, Hi = Ixx * Iyy - Ixy * Ixy;
      wx = (Ai * lx + Bi * ly + Ci * lz) / det; wy = (Bi * lx + Ei * ly + Fi * lz) / det; wz = (Ci * lx + Fi * ly + Hi * lz) / det;
    }
    // Rozkład biegunowy A → R (iteracja Highama), reszta dopasowania
    const R = polar(A);
    const kat = (Math.acos(Math.min(1, Math.max(-1, (R[0] + R[4] + R[8] - 1) / 2))) * 180) / Math.PI;
    let res = 0, resMax = 0;
    for (const i of cale) {
      const X0 = pos0[3 * i] - x0, Y0 = pos0[3 * i + 1] - y0, Z0 = pos0[3 * i + 2] - z0;
      const ex = pos[3 * i] - x - (R[0] * X0 + R[1] * Y0 + R[2] * Z0), ey = pos[3 * i + 1] - y - (R[3] * X0 + R[4] * Y0 + R[5] * Z0), ez = pos[3 * i + 2] - z - (R[6] * X0 + R[7] * Y0 + R[8] * Z0);
      const q = Math.sqrt(ex * ex + ey * ey + ez * ez);
      res += q;
      if (q > resMax) resMax = q;
    }
    return {
      n: idx.length, nPoza: poza.length, najw: nMax, ulamek: nMax / (idx.length || 1), oderwPoza, ulOderwPoza: oderwPoza / (poza.length || 1), ulStratPoza: strat / (poza.length || 1),
      v: [vx, vy, vz], com: [x, y, z], w: (Math.sqrt(wx * wx + wy * wy + wz * wz) * 180) / Math.PI, wVec: [wx, wy, wz], kat, res: res / c, resMax,
      lWlasny: Math.sqrt(lx * lx + ly * ly + lz * lz),
    };
  };
  return { N, P: [Px, Py, Pz], L: [Lx, Ly, Lz], Ek, kosze, com: [cx, cy, cz], gora: polowa(1), dol: polowa(-1), zerw: stan.zerwanych };
}

/**
 * Test jednego podkroku (§ 8): wzór (Node) kontra wynik (GPU albo mutacja), węzeł po węźle. Progi: maski 0 różnic, S, A, L, D do 1e−3, |Δa| do 5.
 * Tablice jak w WzorzecCpu.stanPoPodkroku; aktywny i nieruchomy z migawki „przed”. Stojące nie mają przyspieszenia.
 */
export function porownajPodkrok(wzor, wynik, aktywny, nieruchomy, { prog = 1e-3, progA = 5 } = {}) {
  const n = aktywny.length;
  const da = new Float64Array(n);
  let maski = 0, s = 0, a = 0, l = 0, d = 0, f0 = 0, etyk = 0, sMax = 0, daMax = 0, m = 0, ponadA = 0;
  for (let i = 0; i < n; i++) {
    if (!aktywny[i]) continue;
    if (wzor.maskaW[i] !== wynik.maskaW[i]) maski++;
    const ds = Math.abs(wzor.szkoda[i] - wynik.szkoda[i]);
    if (ds > prog) s++;
    if (ds > sMax) sMax = ds;
    if (Math.abs(wzor.A[i] - wynik.A[i]) > prog) a++;
    if (wzor.etyk[i] !== wynik.etyk[i]) etyk++;
    for (let q = 18 * i; q < 18 * i + 18; q++) {
      if (Math.abs(wzor.L[q] - wynik.L[q]) > prog) l++;
      if (Math.abs(wzor.D[q] - wynik.D[q]) > prog) d++;
      if (Math.abs(wzor.F0[q] - wynik.F0[q]) > 1) f0++;
    }
    if (nieruchomy[i]) continue;
    const ax = wzor.acc[3 * i] - wynik.acc[3 * i], ay = wzor.acc[3 * i + 1] - wynik.acc[3 * i + 1], az = wzor.acc[3 * i + 2] - wynik.acc[3 * i + 2];
    const q = Math.sqrt(ax * ax + ay * ay + az * az);
    da[m++] = q;
    if (q > daMax) daMax = q;
    if (q > progA) ponadA++;
  }
  const po = da.subarray(0, m).sort();
  const pr = (x) => (m ? po[Math.min(m - 1, Math.floor(x * m))] : 0);
  return { maski, s, sMax, a, l, d, f0, etyk, daMax, daP50: pr(0.5), daP99: pr(0.99), ponadA, zaliczony: maski === 0 && s === 0 && a === 0 && l === 0 && d === 0 && daMax <= progA };
}
