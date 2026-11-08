// Budowa „wypieku” sceny (docs/SPEC-woksele-zawalenia.md § 2.3): sąsiedzi, statyka CG, sprężenie, ziarna, wytrzymałości, kontakty.
// Moduł czysty: bez three, DOM i window. Ten sam wypiek zasila wzorzec CPU (wzorzec-cpu.js) i solver GPU.
// Port części konstrukcyjnej `model-spec4.mjs` bez gałęzi wyłączonych przez parametry końcowe (§ 2.1).
// Liczy się w double i zapisuje do tablic Float32 tak samo jak prototyp: wynik jest IDENTYCZNY BAJTOWO
// (kolejność losowania i działań ma znaczenie, strażnik tests/wokseleBudowa.test.mjs), a o przechyle wieży decyduje budowa (§ 1.2).
import { prng, czyGrunt, szum2, planGpu } from './scena.js';

// Pary (d, d ^ 1) są przeciwne. Pierwsze 6 to osie.
export const KIER = Object.freeze([
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  [1, 1, 0], [-1, -1, 0], [1, -1, 0], [-1, 1, 0],
  [1, 0, 1], [-1, 0, -1], [1, 0, -1], [-1, 0, 1],
  [0, 1, 1], [0, -1, -1], [0, 1, -1], [0, -1, 1],
]);
/** Numer bitu flagi węzła: część o kształcie kół wokół osi habitatu, rogi jej bloków dociąga obraz. */
export const BIT_KOLO = 18;
export const ND = KIER.length;
export const STRONA = 18;
export const N0X = new Float64Array(ND);
export const N0Y = new Float64Array(ND);
export const N0Z = new Float64Array(ND);
for (let d = 0; d < ND; d++) {
  const l = Math.sqrt(KIER[d][0] ** 2 + KIER[d][1] ** 2 + KIER[d][2] ** 2);
  N0X[d] = KIER[d][0] / l; N0Y[d] = KIER[d][1] / l; N0Z[d] = KIER[d][2] / l;
}

export const KLASA_NAZWY = Object.freeze(['strop', 'kolumna', 'fasada', 'rdzen', 'dysk', 'kotwica']);

/** Parametry końcowe (`proby4/parametry-spec4.json` na `DOMYSLNE`), tabele § 2.1. */
export const PARAMETRY = Object.freeze({
  c: 6000,              // prędkość fali wzdłużnej, j./s
  podkroki: 8,          // na klatkę 60 Hz przy dx = 20
  zeta: 0.1,            // tłumienie wzdłuż wiązania (ułamek 2·√K)
  beta: 0.1,            // zginanie: kB = beta·K
  zlomGiecia: 0.25,     // |b| ponad to (w dx): zerwanie linii
  zlomB: 2.5,           // plastycznie do bMax·zlomB
  kKontakt: 0.8,
  rKontakt: 0.9,        // średnica sfery kontaktu względem dx
  rJitter: 0.1,
  zetaKontakt: 0.35,
  mu: 0.9,
  cTarcie: 1,
  muGrunt: 0.7,
  skorKontakt: 0.5,     // naddatek listy (w dx)
  slotyListy: 32,       // M
  slotyKomorki: 24,     // S: maks. 23 w komórce, § 2.7. model-spec4 liczył przy 16 i to wchodzi tylko przez tests/helpers/wokseleBiegi.mjs
  nKom: 65536,          // § 2.7: przy każdej scenie
  rytmListy: 4,         // lista co tyle podkroków
  vMax: 4000,
  rozcHard: 0.5,
  sciskHard: 0.45,
  katWypieku: 12,
  szokTempo: 1.5,
  szokWsp: 0.5,
  kontaktSzokV: 120,
  zapasMin: 2.2,
  zapasDyskPrez: 1.25,
  obwodSlabszy: 0.35,
  dyskSprezenie: 0.005,
  kotwicaWzmocnienie: 3,
  kotwicaZasieg: 6,
  plama: { rozmiar: 4, sila: 0.5 },
  gruzPara: 27,         // 1/s na kontakt
  gruzV: 30,
  lepL: 10,
  lepV: 25,
  wagaS: 1.5,
  wagaProg: 0.4,
  fala: { v: 60, tempo: 9, aMax: 0.6, prog: 0.5, oslab: 0.999 },
  falaPeka: { prog: 0.25, zakres: 0.5 },
  ziarno: 7,
  kalibracja: { tol: 1e-8, maxIter: 20000, reg: 1e-9 },
  kLin: { strop: 1, kolumna: 1, fasada: 0.02, rdzen: 0.5, dysk: 1, kotwica: 1 },
  klasy: {
    strop: { SF: 2.8, eMin: 0.0007, rozc: 0.6, dT: 0.05, dC: 0.1, rozrzut: 0.25, krusz: 0.8, rozlew: 0.5, kontaktSzok: 0.5 },
    kolumna: { SF: 2.8, eMin: 0.002, rozc: 0.8, dT: 0.15, dC: 0.1, rozrzut: 0.2, krusz: 1, rozlew: 0.6, szok: 1, kontaktSzok: 0.5 },
    fasada: { SF: 2.8, eMin: 0.001, rozc: 0.8, dT: 0.15, dC: 0.1, rozrzut: 0.3, krusz: 0.8, rozlew: 0.5, kontaktSzok: 0.5 },
    rdzen: { SF: 2.8, eMin: 0.002, rozc: 0.6, dT: 0.08, dC: 0.1, rozrzut: 0.25, krusz: 0.8, rozlew: 0.5, kontaktSzok: 0.5 },
    dysk: { SF: 1, eMin: 0.03, rozc: 1, dT: 0.05, dC: 0.1, rozrzut: 0.35, krusz: 1.2, rozlew: 0.82, zlom: 0.12, szok: 3, kontaktSzok: 1 },
    kotwica: { SF: 1, eMin: 0.2, rozc: 1, dT: 0.3, dC: 0.3, rozrzut: 0, krusz: 0 },
  },
  ziarna: {
    strop: [7, 7, 99], dach: [4, 4, 99], kolumna: [99, 99, 6], fasada: [3, 3, 6], rdzen: [6, 6, 6], dysk: [4, 4, 99],
    wewn: 6, granica: 0.7, kruszWewn: 0, zlomWewn: 3, waga: 0.5,
    kl: { dysk: { wewn: 1.5, granica: 1, kruszWewn: 0.6 } },
  },
});

/** Płytka nakładka na parametry (ziarno, próby). Klasy scalane polami. */
export function parametry(nakladka = {}) {
  const w = { ...PARAMETRY, ...nakladka };
  if (nakladka.klasy) {
    w.klasy = { ...PARAMETRY.klasy };
    for (const k of Object.keys(nakladka.klasy)) w.klasy[k] = { ...PARAMETRY.klasy[k], ...nakladka.klasy[k] };
  }
  return w;
}

export function klasaPary(a, b) {
  if (a === 5 || b === 5) return 5;
  if (a === 4 || b === 4) return 4;
  if (a === 0 || b === 0) return 0;
  if (a === 2 || b === 2) return 2;
  if (a === 3 || b === 3) return 3;
  return 1;
}

export function popcnt(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

/**
 * Źródło grawitacji (§ 10.4): scena.zrodlo = { stala: [gx, gy, gz], punkt: { c, g, r0 }, obrot: { p, os, om } }.
 * Bez pola: stały kierunek −z o sile scena.g.
 */
export function zrodloSceny(scena) {
  const z = scena.zrodlo ?? { stala: [0, 0, -(scena.g ?? 0)] };
  const st = z.stala ?? [0, 0, 0];
  const w = { gx: st[0], gy: st[1], gz: st[2], punkt: null, obrot: null };
  let gMod = Math.sqrt(st[0] * st[0] + st[1] * st[1] + st[2] * st[2]);
  if (z.punkt) {
    w.punkt = { cx: z.punkt.c[0], cy: z.punkt.c[1], cz: z.punkt.c[2], g: z.punkt.g, r0: z.punkt.r0 ?? 0 };
    gMod = Math.max(gMod, z.punkt.g);
  }
  if (z.obrot) {
    const l = Math.sqrt(z.obrot.os[0] ** 2 + z.obrot.os[1] ** 2 + z.obrot.os[2] ** 2);
    w.obrot = { px: z.obrot.p[0], py: z.obrot.p[1], pz: z.obrot.p[2], ox: z.obrot.os[0] / l, oy: z.obrot.os[1] / l, oz: z.obrot.os[2] / l, om: z.obrot.om };
    gMod = Math.max(gMod, z.gRef ?? 0);
  }
  w.gMod = scena.gRef ?? gMod;
  return w;
}

/** Pole grawitacji w punkcie (linia 594 modelu, § 10.4), wynik do w[0..2]; bez skali uSkG. */
export function gWezla(zr, x, y, z, vx, vy, vz, w) {
  let gx = zr.gx, gy = zr.gy, gz = zr.gz;
  if (zr.punkt) {
    const q = zr.punkt;
    const ex = q.cx - x, ey = q.cy - y, ez = q.cz - z;
    const r2 = ex * ex + ey * ey + ez * ez + 1e-6;
    const ir = 1 / Math.sqrt(r2);
    const a = (q.r0 > 0 ? (q.g * q.r0 * q.r0) / r2 : q.g) * ir;
    gx += a * ex; gy += a * ey; gz += a * ez;
  }
  if (zr.obrot) {
    const q = zr.obrot;
    const ex = x - q.px, ey = y - q.py, ez = z - q.pz;
    const c = ex * q.ox + ey * q.oy + ez * q.oz;
    const om2 = q.om * q.om;
    gx += om2 * (ex - c * q.ox); gy += om2 * (ey - c * q.oy); gz += om2 * (ez - c * q.oz); // odśrodkowa
    const k = -2 * q.om;
    gx += k * (q.oy * vz - q.oz * vy); gy += k * (q.oz * vx - q.ox * vz); gz += k * (q.ox * vy - q.oy * vx); // Coriolis
  }
  w[0] = gx; w[1] = gy; w[2] = gz;
}

/**
 * Statyka liniowa K u = m g: CG bez macierzy z preconditionerem Jacobiego, Float64. Ładunek zerowy zwraca zera (§ 10.2: 0/0 dawało NaN).
 * ladunek(i, w): w[0..2] = przyspieszenie węzła i.
 */
function rozwiazStatyke(s, wezly, zamrozone, ladunek) {
  const { n, nbr, pos, K, kind, par } = s;
  const p = par.kalibracja;
  const lw = [0, 0, 0];
  const u = new Float64Array(3 * n), r = new Float64Array(3 * n), q = new Float64Array(3 * n), kier = new Float64Array(3 * n), z = new Float64Array(3 * n);
  const dg = new Float64Array(3 * n);
  const NX = new Float64Array(STRONA * n), NY = new Float64Array(STRONA * n), NZ = new Float64Array(STRONA * n);
  const KL = new Float64Array(STRONA * n);
  const kLinTab = KLASA_NAZWY.map((x) => par.kLin[x] * K);
  for (const i of wezly) {
    for (let d = 0; d < ND; d++) {
      const ox = STRONA * i + d;
      const j = nbr[ox];
      if (j < 0) continue;
      const dX = pos[3 * j] - pos[3 * i], dY = pos[3 * j + 1] - pos[3 * i + 1], dZ = pos[3 * j + 2] - pos[3 * i + 2];
      const rr = Math.sqrt(dX * dX + dY * dY + dZ * dZ);
      NX[ox] = dX / rr; NY[ox] = dY / rr; NZ[ox] = dZ / rr;
      const kl = kLinTab[klasaPary(kind[i], kind[j])];
      KL[ox] = kl;
      dg[3 * i] += kl * NX[ox] * NX[ox];
      dg[3 * i + 1] += kl * NY[ox] * NY[ox];
      dg[3 * i + 2] += kl * NZ[ox] * NZ[ox];
    }
  }
  const reg = p.reg * K;
  const mnoz = (w, wy) => {
    for (const i of wezly) {
      if (zamrozone[i]) { wy[3 * i] = wy[3 * i + 1] = wy[3 * i + 2] = 0; continue; }
      let ax = reg * w[3 * i], ay = reg * w[3 * i + 1], az = reg * w[3 * i + 2];
      for (let d = 0; d < ND; d++) {
        const ox = STRONA * i + d;
        const j = nbr[ox];
        if (j < 0) continue;
        const nx = NX[ox], ny = NY[ox], nz = NZ[ox];
        const f = KL[ox] * (nx * (w[3 * i] - w[3 * j]) + ny * (w[3 * i + 1] - w[3 * j + 1]) + nz * (w[3 * i + 2] - w[3 * j + 2]));
        ax += f * nx; ay += f * ny; az += f * nz;
      }
      wy[3 * i] = ax; wy[3 * i + 1] = ay; wy[3 * i + 2] = az;
    }
  };
  let rz = 0, r0 = 0;
  for (const i of wezly) {
    if (zamrozone[i]) continue;
    ladunek(i, lw);
    r[3 * i] = lw[0]; r[3 * i + 1] = lw[1]; r[3 * i + 2] = lw[2];
    r0 += lw[0] * lw[0] + lw[1] * lw[1] + lw[2] * lw[2];
  }
  if (r0 === 0) return { u, NX, NY, NZ, KL, iter: 0, residuum: 0 };
  const prec = () => {
    let suma = 0;
    for (const i of wezly) {
      if (zamrozone[i]) { z[3 * i] = z[3 * i + 1] = z[3 * i + 2] = 0; continue; }
      for (let c = 0; c < 3; c++) {
        z[3 * i + c] = r[3 * i + c] / (dg[3 * i + c] + reg);
        suma += r[3 * i + c] * z[3 * i + c];
      }
    }
    return suma;
  };
  rz = prec();
  kier.set(z);
  let it = 0, rr = r0;
  for (; it < p.maxIter; it++) {
    mnoz(kier, q);
    let sq = 0;
    for (const i of wezly) for (let c = 0; c < 3; c++) sq += kier[3 * i + c] * q[3 * i + c];
    const a = rz / sq;
    rr = 0;
    for (const i of wezly) {
      if (zamrozone[i]) continue;
      for (let c = 0; c < 3; c++) {
        u[3 * i + c] += a * kier[3 * i + c];
        r[3 * i + c] -= a * q[3 * i + c];
        rr += r[3 * i + c] * r[3 * i + c];
      }
    }
    if (rr < p.tol * p.tol * r0) break;
    const rzN = prec();
    const b = rzN / rz;
    rz = rzN;
    for (const i of wezly) for (let c = 0; c < 3; c++) kier[3 * i + c] = z[3 * i + c] + b * kier[3 * i + c];
  }
  return { u, NX, NY, NZ, KL, iter: it, residuum: Math.sqrt(rr / r0) };
}

/**
 * Statyka dzielnicy (scenaMiasta.js): meta.budynki to rozłączne bryły, więc CG po budynku, a nie na całej scenie, gdzie liczba iteracji idzie za najwyższym, a koszt iteracji za wszystkimi.
 * Budynki o tym samym kluczu mają tę samą siatkę i kolejność węzłów, więc jeden CG na klucz. Grawitacja równoległa do projektowej, jak w wieży z kotwicami: F0 = skala · f0.
 */
function statykaBudynkow(s, scena, gP, dP, skalaF0, f0, F0, nieruchomy, info) {
  const { nbr, pos, K, kind, par } = s;
  const { ijk } = scena;
  const pamiec = new Map();
  let maxF = 0, maxU = 0, maxIter = 0, maxRes = 0;
  for (const b of scena.meta.budynki) {
    const nb = b.n, st0 = b.start;
    let st = pamiec.get(b.klucz);
    if (!st) {
      const lNbr = new Int32Array(STRONA * nb);
      for (let q = 0; q < STRONA * nb; q++) { const v = nbr[STRONA * st0 + q]; lNbr[q] = v < 0 ? -1 : v - st0; }
      const zam = new Uint8Array(nb);
      const wezly = new Int32Array(nb);
      for (let i = 0; i < nb; i++) { wezly[i] = i; if (ijk[3 * (st0 + i) + 2] === 0) zam[i] = 1; }
      st = rozwiazStatyke({ n: nb, nbr: lNbr, pos: pos.subarray(3 * st0, 3 * (st0 + nb)), K, kind: kind.subarray(st0, st0 + nb), par }, wezly, zam, (i, w) => { w[0] = gP * dP[0]; w[1] = gP * dP[1]; w[2] = gP * dP[2]; });
      pamiec.set(b.klucz, st);
      maxIter = Math.max(maxIter, st.iter);
      maxRes = Math.max(maxRes, st.residuum);
    }
    for (let i = 0; i < nb; i++) {
      const ux = st.u[3 * i], uy = st.u[3 * i + 1], uz = st.u[3 * i + 2];
      maxU = Math.max(maxU, Math.sqrt(ux * ux + uy * uy + uz * uz));
      if (ijk[3 * (st0 + i) + 2] === 0) nieruchomy[st0 + i] = 1;
      for (let d = 0; d < ND; d++) {
        const lo = STRONA * i + d;
        const ox = STRONA * (st0 + i) + d;
        const j = nbr[ox] - st0;
        if (j < 0) continue;
        const f = st.KL[lo] * (st.NX[lo] * (st.u[3 * j] - ux) + st.NY[lo] * (st.u[3 * j + 1] - uy) + st.NZ[lo] * (st.u[3 * j + 2] - uz));
        f0[ox] = f;
        F0[ox] = f * skalaF0;
        maxF = Math.max(maxF, Math.abs(f));
      }
    }
  }
  info.grupy.wieza = { iter: maxIter, residuum: maxRes, maxUgiecieLiniowe: maxU, maxF0: maxF, odkMax: maxF / (K * s.dx), statyk: pamiec.size };
}

function budujSasiadow(s) {
  const { n, nbr, R0, L, maska, scena } = s;
  const { ijk, grupa, pos } = scena;
  const nGrup = scena.meta.grupy.length;
  for (let g = 0; g < nGrup; g++) {
    let ni = 0, nj = 0, nk = 0;
    for (let i = 0; i < n; i++) {
      if (grupa[i] !== g) continue;
      ni = Math.max(ni, ijk[3 * i] + 1);
      nj = Math.max(nj, ijk[3 * i + 1] + 1);
      nk = Math.max(nk, ijk[3 * i + 2] + 1);
    }
    const siatka = new Int32Array(ni * nj * nk).fill(-1);
    for (let i = 0; i < n; i++) {
      if (grupa[i] === g) siatka[(ijk[3 * i + 2] * nj + ijk[3 * i + 1]) * ni + ijk[3 * i]] = i;
    }
    for (let i = 0; i < n; i++) {
      if (grupa[i] !== g) continue;
      for (let d = 0; d < ND; d++) {
        const a = ijk[3 * i] + KIER[d][0], b = ijk[3 * i + 1] + KIER[d][1], c = ijk[3 * i + 2] + KIER[d][2];
        if (a < 0 || b < 0 || c < 0 || a >= ni || b >= nj || c >= nk) continue;
        const j = siatka[(c * nj + b) * ni + a];
        if (j < 0) continue;
        const ox = STRONA * i + d;
        nbr[ox] = j;
        const dX = pos[3 * j] - pos[3 * i], dY = pos[3 * j + 1] - pos[3 * i + 1], dZ = pos[3 * j + 2] - pos[3 * i + 2];
        R0[ox] = Math.sqrt(dX * dX + dY * dY + dZ * dZ);
        L[ox] = R0[ox];
        maska[i] |= 1 << d;
      }
    }
  }
  for (let i = 0; i < n; i++) s.iN0[i] = 1 / Math.max(1, popcnt(maska[i]));
}

/** Etykieta BFS: odległość w skokach od węzłów z etykietą 0 (po wszystkich wiązaniach). Zwraca największą. */
function rozlejEtykiete(etyk, nbr, wezly) {
  let zm = true;
  while (zm) {
    zm = false;
    for (let q = 0; q < wezly.length; q++) {
      const i = wezly[q];
      let e = etyk[i];
      for (let d = 0; d < ND; d++) {
        const j = nbr[STRONA * i + d];
        if (j >= 0 && etyk[j] + 1 < e) e = etyk[j] + 1;
      }
      if (e !== etyk[i]) { etyk[i] = e; zm = true; }
    }
  }
  let mx = 0;
  for (let q = 0; q < wezly.length; q++) if (etyk[wezly[q]] > mx) mx = etyk[wezly[q]];
  return mx;
}

/** Voronoi ważony na siatce komórek ijk grupy, przy budowie, więc obrót budynku nic nie zmienia (§ 2.3, krok 6). */
function budujZiarna(s) {
  const { n, scena, par } = s;
  const ziarnoW = new Int32Array(n).fill(-1);
  const zp = par.ziarna;
  const { ijk, kind, grupa } = scena;
  const hasz = (a, b, c, e) => {
    let h = Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791) ^ Math.imul(e, 2654435761);
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    h ^= h >>> 15;
    h = Math.imul(h, 0x9E3779B1);
    return (h ^ (h >>> 16)) >>> 0;
  };
  const u = (h, q) => ((h >>> q) & 255) / 255;
  for (let i = 0; i < n; i++) {
    let skl = zp[KLASA_NAZWY[kind[i]]];
    // Płyta dachu: dwie najwyższe warstwy stropu wieży jako samodzielnej sceny. W S3 (meta.wieza) pocisk nie ma ziaren dachu, jak w prototypie.
    if (zp.dach && kind[i] === 0 && scena.meta.wieza === undefined && ijk[3 * i + 2] >= scena.meta.nz - 2) skl = zp.dach;
    if (!skl) continue;
    // Bok ziarna w komórkach przy dx = 20: poza tym dx mnożony przez skalę, żeby kawałek miał ten sam rozmiar w jednostkach gry (§ 2.1). Bez tego przy dx = 40 ziarno ma 280 j., strop jest prawie cały wnętrzem ziarna (× 6) i górna masa zostaje sztywną płytą, która się przewraca.
    const skZ = s.skalaZiarna;
    const [sx, sy, sz] = skl;
    const X = ijk[3 * i] / (sx * skZ), Y = ijk[3 * i + 1] / (sy * skZ), Z = ijk[3 * i + 2] / (sz * skZ);
    const a0 = Math.floor(X), b0 = Math.floor(Y), c0 = Math.floor(Z);
    let best = Infinity, id = -1;
    for (let dc = -1; dc <= 1; dc++) for (let db = -1; db <= 1; db++) for (let da = -1; da <= 1; da++) {
      const a = a0 + da, b = b0 + db, c = c0 + dc;
      const h = hasz(a, b, c, kind[i] * 17 + grupa[i] * 131 + par.ziarno);
      const qx = a + u(h, 0), qy = b + u(h, 8), qz = c + u(h, 16);
      const d2 = Math.sqrt((X - qx) ** 2 + (Y - qy) ** 2 + (Z - qz) ** 2) - zp.waga * u(h, 24);
      if (d2 < best) { best = d2; id = h % 1000000007; }
    }
    ziarnoW[i] = id;
  }
  return ziarnoW;
}

/**
 * Wypiek sceny: tablice stałe i stan początkowy.
 * opcje.pamiecStatyki: Map na wynik CG (klucz z scena.kluczStatyki + obciążenie projektowe). Statyka projektu nie zależy od miejsca,
 * więc S1, S2, S4 i próby tej samej wieży liczą ją raz.
 */
export function zbuduj(scena, par = PARAMETRY, opcje = {}) {
  const n = scena.n;
  const dx = scena.dx;
  const zr = zrodloSceny(scena);
  const gProj = scena.gProj ?? zr.gMod;
  const gProjDir = scena.gProjDir ?? [0, 0, -1];
  const kotwiceWiezy = scena.kotwice ?? !scena.vel0;
  // Rama odniesienia: istnieje, gdy w scenie jest coś nieruchomego. Bez niej prędkość bezwzględna nic nie znaczy (§ 10.3).
  const rama = czyGrunt(scena.gruntZ) || kotwiceWiezy || scena.meta.grupy.some((q) => q.nazwa === 'dysk');
  // AGENT: par.skalaBud (plan LOD § 5): budynek to model wieży z kalibracji w skali s. Długości materiału (ziarno, plama, mięknięcie, próg zginania, rozlew) idą za budynkiem, prędkości progowe z √s, tempa z 1/√s (Froude, ustawUniformy w solver.js).
  const skalaBud = par.skalaBud ?? 1;
  const skala = (20 * skalaBud) / dx; // 1 przy dx = 20 i budynku jak wieża
  // AGENT: par.cZDx (metoda E planu LOD, docs/PLAN-zawalenia-lod-miasto.md): c ∝ dx, więc K i podkroki jak przy dx = 20. par.cFroude: c ∝ √s, podkroki ze stabilności przy c, dx. Bez nich c stałe, a podkroki rosną z 1/dx (§ 2.1).
  // AGENT: par.sztywnosc (demo kawałków, zgłoszenie 2026-11-08 „szyja jak guma”): mnożnik prędkości fali, więc K × sztywność², podkroki × sztywność (stabilność),
  // a wytrzymałości bez zmian (podłoga z K0 przy par.c, reszta z sił statyki). Przy c = 6000 i dx = 40 szyja bazy stoi ściśnięta o 23 % pod własnym ciężarem. Bez pola 1: bajt w bajt jak dotąd.
  const sztyw = par.sztywnosc ?? 1;
  const cEf = (par.cFroude ? par.c * Math.sqrt(skalaBud) : par.cZDx ? (par.c * dx) / 20 : par.c) * sztyw;
  const pkZStab = (par.podkroki * 20 * cEf) / par.c / dx; // h·√(12K) = 1,25, § 2.1
  const podkrokiEf = par.cZDx ? Math.round(par.podkroki * sztyw) : Math.max(1, par.cFroude ? Math.ceil(pkZStab - 0.1) : Math.round(pkZStab));
  const sM = gProj > 0 ? gProj / 400 : 1; // skala materiału
  const K = (cEf / dx) ** 2 / 3 * sM;
  const K0 = (par.c * Math.sqrt(skalaBud) / dx) ** 2 / 3 * sM;
  const h = 1 / 60 / podkrokiEf;
  // Lista kontaktów co tyle podkroków. Naddatek listy to 0,5 dx, więc odstęp w czasie rośnie z dx (przy dx = 20 co 1/120 s), najwyżej raz na krok, co najmniej co podkrok.
  const rytmEf = Math.min(podkrokiEf, Math.max(1, Math.round((par.rytmListy / par.podkroki) * (dx / (20 * Math.sqrt(skalaBud))) * podkrokiEf)));
  const kC = par.kKontakt * K;
  const cC = 2 * par.zetaKontakt * Math.sqrt(kC * 0.5);

  const s = {
    n, dx, scena, par, K, skalaZiarna: skala,
    pos: scena.pos,
    kind: scena.kind,
    nbr: new Int32Array(STRONA * n).fill(-1),
    R0: new Float32Array(STRONA * n),
    L: new Float32Array(STRONA * n),
    maska: new Uint32Array(n),
    iN0: new Float32Array(n),
  };

  // Tablice na węzeł, w tej kolejności co prototyp (aLos z własnego strumienia).
  const aLos = new Float32Array(n);
  {
    const lA = prng(par.ziarno + 909);
    for (let i = 0; i < n; i++) { const q = lA(); aLos[i] = q * q; }
  }
  const rozlewW = new Float32Array(n);
  const szokW = new Float32Array(n);
  const kUd = new Float32Array(n);
  const bMax2W = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const kl = par.klasy[KLASA_NAZWY[scena.kind[i]]];
    rozlewW[i] = Math.pow(kl.rozlew ?? 0, 1 / skala); // szerokość strefy w jednostkach gry nie zależy od dx
    szokW[i] = kl.szok ?? par.szokWsp;
    kUd[i] = kl.kontaktSzok ?? 0;
    // Próg to krzywizna: b = κ·dx², więc przy stałej krzywiźnie granicznej b_max ~ dx² (przy dx = 20 bez zmian).
    // par.kruchoscGiecia (demo kawałków, przełącznik kruchości): mnożnik granicy gięcia wszystkich klas. Bez niego 1, a wynik bajt w bajt jak dotąd.
    bMax2W[i] = (((kl.zlom ?? par.zlomGiecia) * (par.kruchoscGiecia ?? 1) * dx * sM) / skala) ** 2;
  }
  const kruszTab = new Float32Array(2 * KLASA_NAZWY.length);
  for (let q = 0; q < KLASA_NAZWY.length; q++) {
    const nazwa = KLASA_NAZWY[q];
    kruszTab[q] = par.klasy[nazwa].krusz;
    kruszTab[q + 6] = kruszTab[q] * (par.ziarna.kl?.[nazwa]?.kruszWewn ?? par.ziarna.kruszWewn);
  }

  budujSasiadow(s);

  // Kalibracja.
  const { nbr, L, R0, maska, iN0 } = s;
  const { kind, ijk, pos } = scena;
  const f0 = new Float32Array(STRONA * n);
  const F0 = new Float32Array(STRONA * n);
  const Ft = new Float32Array(STRONA * n);
  const Fc = new Float32Array(STRONA * n);
  const iT = new Float32Array(STRONA * n);
  const iC = new Float32Array(STRONA * n);
  const nieruchomy = new Uint8Array(n);
  const bezG = new Uint8Array(n); // węzły dysku: ważą dopiero po oderwaniu od kotwicy
  const grupy = scena.meta.grupy;
  const info = { grupy: {} };

  // Grupa „wieza”: statyka z podporą projektową w dolnej warstwie. Z kotwicami wieża jest sprężona (zero ugięcia), bez nich F0 = 0,
  // a f0 służy tylko do wytrzymałości (§ 2.3, kroki 3–4).
  const gw = grupy.find((x) => x.nazwa === 'wieza');
  const wWiezy = gw ? Array.from({ length: gw.n }, (_, q) => gw.start + q) : [];
  const swobodna = !!gw && !kotwiceWiezy;
  if (gw && scena.meta.budynki) {
    statykaBudynkow(s, scena, gProj, gProjDir, zr.gMod / gProj, f0, F0, nieruchomy, info);
  } else if (gw) {
    const zam = new Uint8Array(n);
    for (const i of wWiezy) if (ijk[3 * i + 2] === 0) zam[i] = 1;
    const gP = gProj, dP = gProjDir;
    const kluczSt = opcje.pamiecStatyki && scena.kluczStatyki ? `${scena.kluczStatyki}:${gP}:${dP.join(',')}` : null;
    let st = kluczSt ? opcje.pamiecStatyki.get(kluczSt) : null;
    if (!st) {
      st = rozwiazStatyke(s, wWiezy, zam, (i, w) => { w[0] = gP * dP[0]; w[1] = gP * dP[1]; w[2] = gP * dP[2]; });
      if (kluczSt) opcje.pamiecStatyki.set(kluczSt, st);
    }
    // Sprężenie: reakcja na obciążenie RZECZYWISTE. Statyka jest liniowa: ten sam kierunek = ta sama droga obciążenia razy skala, bez drugiego CG.
    const rownolegle = !zr.punkt && !zr.obrot && gP > 0
      && Math.abs(zr.gx * dP[1] - zr.gy * dP[0]) + Math.abs(zr.gy * dP[2] - zr.gz * dP[1]) + Math.abs(zr.gz * dP[0] - zr.gx * dP[2]) < 1e-9 * (zr.gMod + 1)
      && (zr.gx * dP[0] + zr.gy * dP[1] + zr.gz * dP[2]) >= 0;
    const skalaF0 = rownolegle ? zr.gMod / gP : 1;
    const stA = swobodna || rownolegle ? st : rozwiazStatyke(s, wWiezy, zam, (i, w) => gWezla(zr, pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], 0, 0, 0, w));
    let maxF = 0, maxU = 0;
    for (const i of wWiezy) {
      const ux = st.u[3 * i], uy = st.u[3 * i + 1], uz = st.u[3 * i + 2];
      maxU = Math.max(maxU, Math.sqrt(ux * ux + uy * uy + uz * uz));
      for (let d = 0; d < ND; d++) {
        const ox = STRONA * i + d;
        const j = nbr[ox];
        if (j < 0) continue;
        const f = st.KL[ox] * (st.NX[ox] * (st.u[3 * j] - ux) + st.NY[ox] * (st.u[3 * j + 1] - uy) + st.NZ[ox] * (st.u[3 * j + 2] - uz));
        f0[ox] = f;
        maxF = Math.max(maxF, Math.abs(f));
        if (!swobodna) {
          const fA = stA === st ? f * skalaF0 : stA.KL[ox] * (stA.NX[ox] * (stA.u[3 * j] - stA.u[3 * i]) + stA.NY[ox] * (stA.u[3 * j + 1] - stA.u[3 * i + 1]) + stA.NZ[ox] * (stA.u[3 * j + 2] - stA.u[3 * i + 2]));
          F0[ox] = fA;
        }
      }
    }
    if (!swobodna) for (const i of wWiezy) if (zam[i]) nieruchomy[i] = 1;
    info.grupy.wieza = { iter: st.iter, residuum: st.residuum, maxUgiecieLiniowe: maxU, maxF0: maxF, odkMax: maxF / (K * dx) };
  }

  // Dysk: pokład jest jednowarstwowy, a siły centralne nie przeniosą ciężaru prostopadle do płaszczyzny, więc kalibracja nie ma rozwiązania.
  // Węzły dysku połączone z kotwicą nie ważą (etykieta odległości od kotwicy) i dostają g dopiero po oderwaniu.
  const gd = grupy.find((x) => x.nazwa === 'dysk');
  const etyk = new Uint16Array(n);
  let capEtyk = 0;
  const NIEODWIEDZONY = 60000;
  if (gd) {
    const wDysku = new Int32Array(gd.n);
    for (let q = 0; q < gd.n; q++) {
      const i = gd.start + q;
      wDysku[q] = i;
      bezG[i] = 1;
      etyk[i] = kind[i] === 5 ? 0 : NIEODWIEDZONY;
      if (kind[i] === 5) nieruchomy[i] = 1;
    }
    const mx = rozlejEtykiete(etyk, nbr, wDysku);
    capEtyk = Math.ceil(mx * 1.5) + 8;
    info.grupy.dysk = { maxEtykieta: mx, cap: capEtyk };
  }
  if (gw) {
    for (const i of wWiezy) etyk[i] = nieruchomy[i] ? 0 : NIEODWIEDZONY;
    if (!swobodna) {
      const mx = rozlejEtykiete(etyk, nbr, wWiezy);
      capEtyk = Math.max(capEtyk, Math.ceil(mx * 1.5) + 8);
      info.grupy.wieza.maxEtykieta = mx;
    }
  }

  // Wytrzymałości: każda para raz, kopie na obu końcach. Rozrzut z PRNG (§ 2.3, krok 7).
  const los = prng(par.ziarno);
  // Szum wartości na grubej siatce: plamy słabszego i mocniejszego materiału, pęknięcia nie biegną po siatce.
  const NZ_S = 64;
  const szum = new Float32Array(NZ_S * NZ_S * NZ_S);
  for (let q = 0; q < szum.length; q++) szum[q] = los();
  const plamaR = Math.max(1e-3, par.plama.rozmiar * dx * skala);
  const smooth = (t) => t * t * (3 - 2 * t);
  const szumW = (x, y, z) => {
    const X = x / plamaR + 1000, Y = y / plamaR + 1000, Z = z / plamaR + 1000;
    const a = Math.floor(X), b = Math.floor(Y), c = Math.floor(Z);
    const fx = smooth(X - a), fy = smooth(Y - b), fz = smooth(Z - c);
    const v = (i, j, k) => szum[(((c + k) & 63) * NZ_S + ((b + j) & 63)) * NZ_S + ((a + i) & 63)];
    const l = (t, q, w) => q + (w - q) * t;
    return l(fz,
      l(fy, l(fx, v(0, 0, 0), v(1, 0, 0)), l(fx, v(0, 1, 0), v(1, 1, 0))),
      l(fy, l(fx, v(0, 0, 1), v(1, 0, 1)), l(fx, v(0, 1, 1), v(1, 1, 1))));
  };
  const ziarnoW = budujZiarna(s);
  const klasaW = new Uint8Array(STRONA * n);
  const zp = par.ziarna;
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < ND; d++) {
      const ox = STRONA * i + d;
      const j = nbr[ox];
      if (j < i) continue; // −1 albo już zrobione z drugiego końca
      const kl = klasaPary(kind[i], kind[j]);
      const c = par.klasy[KLASA_NAZWY[kl]];
      const f = f0[ox];
      // Podłoga wytrzymałości to siła, nie odkształcenie: przy c ∝ dx liczona z K materiału c = par.c, inaczej przy dx = 80 wieża ma podłogę × 16 względem ciężaru i stoi po cięciu (plan LOD § 5).
      const baza = Math.max(Math.abs(f), c.eMin * K0 * dx * (kl <= 3 ? sM : 1));
      const mxB = 0.5 * (pos[3 * i] + pos[3 * j]), myB = 0.5 * (pos[3 * i + 1] + pos[3 * j + 1]), mzB = 0.5 * (pos[3 * i + 2] + pos[3 * j + 2]);
      const pl = 1 + par.plama.sila * (2 * szumW(mxB, myB, mzB) - 1);
      const sk = (1 + c.rozrzut * (2 * los() - 1)) * pl;
      const wewn = ziarnoW[i] === ziarnoW[j] && ziarnoW[i] >= 0;
      const zk = zp.kl?.[KLASA_NAZWY[kl]];
      const mZ = wewn ? (zk?.wewn ?? zp.wewn) : (zk?.granica ?? zp.granica);
      let fc = c.SF * baza * sk * mZ;
      let ft = c.SF * c.rozc * baza * sk * mZ;
      if (f > 0) ft = Math.max(par.zapasMin * f, ft);
      else fc = Math.max(par.zapasMin * -f, fc);
      if (kl === 5 && KIER[d][2] === 0) {
        const nz = scena.meta.dysk.nz;
        const k = ijk[3 * i + 2];
        if (k === 0 || k === nz - 1) L[ox] = R0[ox] * (1 - par.dyskSprezenie);
      }
      if (kl === 4) {
        // Dysk: obwodowe słabsze (pęknięcia biegną promieniście), przy kotwicy mocniejszy.
        const mx = pos[3 * i] + 0.5 * KIER[d][0] * dx, my = pos[3 * i + 1] + 0.5 * KIER[d][1] * dx;
        const r = Math.sqrt(mx * mx + my * my) + 1e-6;
        const dl = Math.sqrt(KIER[d][0] ** 2 + KIER[d][1] ** 2 + KIER[d][2] ** 2);
        const cr = (KIER[d][0] * mx + KIER[d][1] * my) / (r * dl);
        const poziome = KIER[d][2] === 0;
        const an = poziome ? 1 - par.obwodSlabszy * (1 - cr * cr) : 1;
        const et = Math.min(etyk[i], etyk[j]);
        const rs = 1 + par.kotwicaWzmocnienie * Math.exp(-et / (par.kotwicaZasieg * skala));
        fc *= rs * an;
        ft *= rs * an;
        // Sprężenie pokładów: wszystkie wiązania w płaszczyźnie pokładu, także do wieńca i kotwicy.
        if (poziome) {
          const nz = scena.meta.dysk.nz;
          const k = ijk[3 * i + 2];
          if (k === 0 || k === nz - 1) {
            const Lp = R0[ox] * (1 - par.dyskSprezenie);
            L[ox] = Lp;
            L[STRONA * j + (d ^ 1)] = Lp;
            ft = Math.max(ft, par.zapasDyskPrez * K * R0[ox] * par.dyskSprezenie);
          }
        }
      }
      const oy = STRONA * j + (d ^ 1);
      Fc[ox] = Fc[oy] = fc;
      Ft[ox] = Ft[oy] = ft;
      // Długość mięknięcia stała w jednostkach gry: energia pękania na pole nie zależy od dx.
      iT[ox] = iT[oy] = 1 / (c.dT * dx * skala);
      iC[ox] = iC[oy] = 1 / (c.dC * dx * skala);
      f0[oy] = f0[ox];
      L[oy] = L[ox];
      F0[oy] = F0[ox];
      klasaW[ox] = klasaW[oy] = wewn ? kl + 6 : kl;
    }
  }
  // Węzeł w środku ziarna (wszyscy sąsiedzi osiowi z tego samego ziarna) gnie się bardziej, zanim pęknie.
  for (let i = 0; i < n; i++) {
    let wsz = ziarnoW[i] >= 0;
    for (let d = 0; d < 6 && wsz; d++) {
      const j = nbr[STRONA * i + d];
      if (j >= 0 && ziarnoW[j] !== ziarnoW[i]) wsz = false;
    }
    if (wsz) bMax2W[i] *= zp.zlomWewn * zp.zlomWewn;
  }

  // Kontakty (§ 2.3, krok 10): rk z własnego strumienia.
  const losK = prng(par.ziarno + 101);
  const rk = new Float32Array(n);
  let rMax = 0;
  for (let i = 0; i < n; i++) {
    rk[i] = 0.5 * dx * par.rKontakt * (1 + par.rJitter * (2 * losK() - 1));
    if (rk[i] > rMax) rMax = rk[i];
  }
  const skor = par.skorKontakt * dx;
  const zasieg = 2 * rMax + skor;
  // LUT kierunku po różnicy ijk: (dk+1)*9 + (dj+1)*3 + (di+1)
  const lutKier = new Int8Array(27).fill(-1);
  for (let d = 0; d < ND; d++) lutKier[(KIER[d][2] + 1) * 9 + (KIER[d][1] + 1) * 3 + KIER[d][0] + 1] = d;

  // Lista wiązań (raz każda para): metryki kawałków.
  let mW = 0;
  for (let i = 0; i < n; i++) for (let d = 0; d < ND; d++) if (nbr[STRONA * i + d] > i) mW++;
  const wa = new Int32Array(mW), wb = new Int32Array(mW), wd = new Uint8Array(mW);
  {
    let q = 0;
    for (let i = 0; i < n; i++) for (let d = 0; d < ND; d++) {
      const j = nbr[STRONA * i + d];
      if (j > i) { wa[q] = i; wb[q] = j; wd[q] = d; q++; }
    }
  }

  // Flagi węzła (§ 2.2): bit 0 stoi, 1 nośny przez kotwicę, 2–4 kind, 5–10 m0 = sześć bitów początkowych osiowych, 11–15 grupa, 16–17 kratery (solver.js), BIT_KOLO obraz.
  const flagi = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    flagi[i] = (nieruchomy[i] ? 1 : 0) | (bezG[i] ? 2 : 0) | (kind[i] << 2) | ((maska[i] & 63) << 5) | (scena.grupa[i] << 11) | ((scena.kola && scena.kola[i] ? 1 : 0) << BIT_KOLO);
  }

  return {
    // Liczby sceny i stałe wiązania (§ 2.1)
    n, dx, skala, skalaBud, podkrokiEf, rytmEf, cEf, h, K, sM, sFr: Math.sqrt(zr.gMod / 400),
    cB: 2 * par.zeta * Math.sqrt(K),
    kB: par.beta * K,
    kC, cC, cT: par.cTarcie * cC,
    cosWypieku: Math.cos((par.katWypieku * Math.PI) / 180),
    gruntZ: scena.gruntZ, zr, gProj, rama, kotwiceWiezy, capEtyk, info,
    // Geometria i ruch początkowy
    pos: scena.pos, vel0: scena.vel0, kind, ijk, grupa: scena.grupa,
    // Tablice stałe na wiązanie (18n)
    nbr, R0, Ft, Fc, iT, iC, klasaW,
    // Tablice stałe na węzeł
    iN0, aLos, rozlewW, szokW, kUd, bMax2W, rk, bezG, ziarnoW, flagi,
    // Stan początkowy
    L, F0, f0, maska, etyk, nieruchomy,
    // Kontakty
    rMax, skor, zasieg, iKom: 1 / zasieg, M: par.slotyListy, S: par.slotyKomorki, nKom: par.nKom, lutKier, kruszTab,
    wa, wb, wd, mW,
    par,
  };
}

/**
 * Wypiek sceny z szwami (S5, § 5.5): po zbuduj, przed pierwszym krokiem. Osłabienie szwów (Ft, Fc), klasy wiązań, cięcie przy budowie, bit pasa. Kernele tego nie znają: to dane w wWiaz i we flagach.
 * Klasa wiązania: szew, pod-szew, pas i tor = klasa bazowa (eksplozja S = 3 tnie), wnętrze sekcji = klasa + 6 (przeżywa).
 * PRNG losowany dla każdego wiązania przed jakimkolwiek continue: wzór szwów nie może zależeć od rodzaju węzła ani od miejsca.
 */
export function wypieczSzwy(w, dane) {
  const { nW, nD, seg, pod, wewnSek, o, u, pX, pY } = dane;
  const los = prng((o.ziarno >>> 0) * 15485863 + 3);
  const szN = szum2(los);
  const n = w.n;
  const nbr = w.nbr, Ft = w.Ft, Fc = w.Fc, kW = w.klasaW, P0 = w.pos, maska = w.maska;
  const pas = new Int8Array(n).fill(100);
  let wSz = 0, wCiete = 0, wWew = 0, wPod = 0, wTorN = 0, wMoc = 0;
  const podW = (i) => (i >= nW && i < nW + nD ? pod[i - nW] : -1);
  for (let i = nW; i < nW + nD; i++) for (let d = 0; d < ND; d++) { const j = nbr[STRONA * i + d]; if (j >= 0 && podW(j) !== podW(i)) { pas[i] = 0; break; } }
  for (let h = 0; h < o.pas; h++) for (let i = nW; i < nW + nD; i++) { if (pas[i] !== h) continue; for (let d = 0; d < ND; d++) { const j = nbr[STRONA * i + d]; if (j >= 0 && pas[j] > h + 1) pas[j] = h + 1; } }
  const wPas = new Float32Array(n);
  for (let i = nW; i < nW + nD; i++) wPas[i] = o.pas * (0.5 + 0.5 * szN(P0[3 * i] / 120, P0[3 * i + 1] / 120));
  const Rw2 = (o.R - o.szerWieniec) ** 2;
  const wWiencu = (i) => P0[3 * i] ** 2 + P0[3 * i + 1] ** 2 > Rw2;
  const paryMoc = new Map(), paryWien = new Map(), mocSek = new Uint8Array(o.nSekcji);
  const losPary = (mapa, a, b, p) => {
    const k = a < b ? a * 4096 + b : b * 4096 + a;
    let v = mapa.get(k);
    if (v === undefined) { v = los() < p; mapa.set(k, v); }
    return v;
  };
  const tnij = (i, d, j) => {
    maska[i] &= ~(1 << d);
    maska[j] &= ~(1 << (d ^ 1));
    wCiete++;
  };
  for (let i = nW; i < nW + nD; i++) {
    for (let d = 0; d < ND; d++) {
      const ox = STRONA * i + d;
      const j = nbr[ox];
      if (j <= i) continue;
      const oy = STRONA * j + (d ^ 1);
      const r1 = los();
      if (kW[ox] === 5 || kW[ox] === 11) continue; // wiązanie kotwicy zostaje mocne
      const mx = 0.5 * (P0[3 * i] + P0[3 * j]) - pX, my = 0.5 * (P0[3 * i + 1] + P0[3 * j + 1]) - pY;
      const sT = mx * u[0] + my * u[1], pT = Math.abs(-mx * u[1] + my * u[0]);
      const wTor = sT > -o.pasTor && sT < o.dlTor && pT < o.pasTor;
      const sa = seg[i - nW], sb = seg[j - nW], pa = pod[i - nW], pb = pod[j - nW];
      if (sa !== sb) {
        kW[ox] = kW[oy] = 4;
        wSz++;
        const wien = wWiencu(i) && wWiencu(j);
        // Los pary zawsze, żeby kolejność PRNG nie zależała od tego, czy węzeł leży w wieńcu.
        const cWien = losPary(paryWien, sa, sb, o.wieniecCiete);
        // Mocny szew: najwyżej mocNaSekcje na sekcję, bez łańcuchów: kawałek przechodzi przez granicę sekcji, ale nie zlepia połowy dysku.
        const kMoc = pa < pb ? pa * 4096 + pb : pb * 4096 + pa;
        let moc = paryMoc.get(kMoc);
        if (moc === undefined) { const rM = los(); moc = rM < o.szewMocUlamek && mocSek[sa] < o.mocNaSekcje && mocSek[sb] < o.mocNaSekcje; if (moc) { mocSek[sa]++; mocSek[sb]++; } paryMoc.set(kMoc, moc); }
        if (wien && cWien) { Ft[ox] *= o.szewF; Ft[oy] = Ft[ox]; Fc[ox] *= o.szewC; Fc[oy] = Fc[ox]; tnij(i, d, j); }
        else if (moc) { Ft[ox] *= o.szewMocF; Ft[oy] = Ft[ox]; Fc[ox] *= o.szewMocF; Fc[oy] = Fc[ox]; wMoc++; }
        else {
          Ft[ox] *= o.szewF; Ft[oy] = Ft[ox];
          Fc[ox] *= o.szewC; Fc[oy] = Fc[ox];
          if (r1 < o.szewCiete) tnij(i, d, j);
        }
      } else if (pa !== pb) {
        const f = (wTor ? o.torF : wewnSek[sa]) * o.podF;
        Ft[ox] *= f; Ft[oy] = Ft[ox]; Fc[ox] *= f; Fc[oy] = Fc[ox];
        kW[ox] = kW[oy] = 4;
        wPod++;
        if (r1 < o.podCiete) tnij(i, d, j);
      } else if (wTor) {
        if (o.torF !== 1) { Ft[ox] *= o.torF; Ft[oy] = Ft[ox]; Fc[ox] *= o.torF; Fc[oy] = Fc[ox]; }
        kW[ox] = kW[oy] = 4;
        wTorN++;
      } else {
        const f = wewnSek[sa];
        Ft[ox] *= f; Ft[oy] = Ft[ox]; Fc[ox] *= f; Fc[oy] = Fc[ox];
        if (pas[i] > wPas[i] && pas[j] > wPas[j]) { kW[ox] = kW[oy] = 10; wWew++; }
      }
    }
  }
  // Cięcie przy budowie nie liczy się jako szkoda: iN0 i bity początkowe w flagach (obraz) po cięciu.
  if (wCiete) for (let i = nW; i < nW + nD; i++) w.iN0[i] = 1 / Math.max(1, popcnt(maska[i] & 0x3ffff));
  for (let i = nW; i < nW + nD; i++) w.flagi[i] = ((w.flagi[i] & ~(63 << 5)) | ((maska[i] & 63) << 5)) >>> 0;
  // Bit „pas”: węzeł ma choć jedno wiązanie, które eksplozja S = 3 może przeciąć. Tylko takie węzły rozrywa reszta kuli (inaczej okrągła łata szkody bez żadnego pęknięcia).
  const bitPas = new Uint8Array(n);
  for (let i = 0; i < n; i++) for (let d = 0; d < ND; d++) { if (nbr[STRONA * i + d] >= 0 && kW[STRONA * i + d] < 6) { bitPas[i] = 1; break; } }
  // Jedno miejsce to jedne dane: próżnia to ta sama budowa bez kotwic (§ 10.4). F0 wieży swobodnej i dysku jest zerem z budowy, zostaje samo uKotwice = 0 (solver czyta je z nieruchomy).
  if (dane.prozn) { w.nieruchomy.fill(0); w.kotwiceWiezy = false; }
  if (!dane.kotwiceWsp.length) w.capEtyk = 0;
  w.bitPas = bitPas;
  return { wSz, wCiete, wWew, wPod, wTor: wTorN, wMoc };
}

/** Budowa planu sceny: wypiek (z nakładką parametrów i szwami, jeśli je ma) i plan GPU. Wspólne dla wątku budowy, strony testowej i testów w Node. */
export function zbudujPlan(plan, opcje = {}) {
  const w = zbuduj(plan.scena, plan.nakladka ? parametry(plan.nakladka) : PARAMETRY, opcje);
  const g = planGpu(plan);
  if (plan.dane) {
    w.szwy = wypieczSzwy(w, plan.dane);
    g.bitPas = w.bitPas;
  }
  if (plan.poWypieku) plan.poWypieku(w); // B1: mocna szyja, która ma się obracać, a nie kruszyć (scenaBazy.js)
  return { w, g };
}
