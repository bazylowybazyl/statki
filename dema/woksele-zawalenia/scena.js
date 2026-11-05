// Geometria i plany scen dema „budowle z wiązanych wokseli” (docs/SPEC-woksele-zawalenia.md § 3, § 5.2, § 10.6).
// Moduł czysty: bez three, DOM i window, działa w Node (testy, scripts/woksele-sym.mjs), w workerze budowy i na stronie.
// Port wspolne/scena.mjs, wspolne/scenariusze.mjs i spec-proby/scenyG.mjs: kolejność węzłów i losowań jak w prototypie,
// bo od niej zależy budowa (§ 2.3, krok 7) i test bajt w bajt (tests/wokseleBudowa.test.mjs).
//
// Scena: { n, dx, pos: Float32Array(3n), kind: Uint8Array(n), ijk: Int32Array(3n), grupa: Uint8Array(n), vel0, meta,
//          g, gProj?, gruntZ, kotwice?, zrodlo?, gRef? }
// pos to środek woksela w jednostkach gry (z w górę), ijk indeks komórki w siatce swojej grupy (obrót grupy go nie zmienia),
// kind: 0 strop, 1 kolumna, 2 fasada, 3 rdzeń, 4 dysk, 5 kotwica dysku.
//
// Plan sceny (wynik S1, S2, S3, S4…): { id, opis, scena, g, T, zdarzeniaOd, zdarzenia(f, model), s3?, czasy? }.
// zdarzenia(f, model) wykonuje na modelu zdarzenia klatki f (numer całkowity, 60 Hz) i zwraca liczbę usuniętych węzłów.
// czasy: { indeksy, t, rozerwij, zostawZiarna }: to samo jako dane dla kernela kCzas (§ 2.8), bez logiki.

/** Generator z ziarnem (mulberry32). Budowa i plany nigdy nie używają Math.random (§ 9). */
export function prng(ziarno = 1) {
  let a = ziarno >>> 0;
  return function losuj() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const KIND = Object.freeze({ STROP: 0, KOLUMNA: 1, FASADA: 2, RDZEN: 3, DYSK: 4, KOTWICA: 5 });
export const NAZWY_KIND = Object.freeze(['strop', 'kolumna', 'fasada', 'rdzen', 'dysk', 'kotwica']);

/** Płaszczyzna gruntu w scenie bez gruntu: żaden węzeł jej nie dosięgnie, a w WGSL nie ma Infinity (§ 2.9). */
export const BRAK_GRUNTU = -1e30;
export const czyGrunt = (gruntZ) => gruntZ > 0.5 * BRAK_GRUNTU;

const PUSTA = new Int32Array(0);
const FPS = 60;

function zScene(n, dx, wypelnij, meta) {
  const pos = new Float32Array(3 * n);
  const kind = new Uint8Array(n);
  const ijk = new Int32Array(3 * n);
  wypelnij(pos, kind, ijk);
  return { n, dx, pos, kind, ijk, grupa: new Uint8Array(n), vel0: null, meta };
}

function zliczKindy(kind) {
  const c = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < kind.length; i++) c[kind[i]]++;
  return { strop: c[0], kolumna: c[1], fasada: c[2], rdzen: c[3], dysk: c[4], kotwica: c[5] };
}

/**
 * Wieża pusta w środku: stropy co `pietroCo` komórek, kolumny na siatce (zwężane ku górze), rdzeń, fasada jako rama z oknami.
 * Opcje w jednostkach gry, reszta w komórkach; domyślne komórkowe wynikają z długości, więc zmiana dx zmienia rozdzielczość, nie budynek.
 */
export function wieza(o = {}) {
  const dx = o.dx ?? 20;
  const w = o.w ?? 380;
  const d = o.d ?? 420;
  const h = o.h ?? 1340;
  const z0 = o.z0 ?? 0;
  const komorek = (dl, min = 1) => Math.max(min, Math.round(dl / dx));
  const gruboscStropu = o.gruboscStropu ?? komorek(40, 2);
  const pietroCo = o.pietroCo ?? Math.max(gruboscStropu + 1, komorek(100));
  const kol = { co: komorek(120, 3), dol: komorek(80, 2), gora: komorek(40, 2), ...o.kolumny };
  const fas = { co: komorek(60, 3), grubosc: komorek(20), nadproze: 0, ...o.fasada };
  const rdz = { ulamek: 0.3, grubosc: komorek(20), ...o.rdzen };
  const gf = fas.grubosc;

  const nx = Math.max(5, Math.round(w / dx));
  const ny = Math.max(5, Math.round(d / dx));
  const nz = Math.max(pietroCo + gruboscStropu, Math.round(h / dx));

  const mStrop = Math.floor((nz - gruboscStropu) / pietroCo); // numer stropu-dachu
  const kDachu = mStrop * pietroCo + gruboscStropu; // pierwsza warstwa attyki

  // Rdzeń: wyśrodkowany prostokąt, parzystość zgodna z rzutem.
  const rozmiarRdzenia = (nn) => {
    let s = Math.max(3, Math.round(rdz.ulamek * nn));
    if ((nn - s) % 2) s++;
    return s;
  };
  const sx = rozmiarRdzenia(nx);
  const sy = rozmiarRdzenia(ny);
  const rx0 = (nx - sx) >> 1;
  const rx1 = rx0 + sx - 1;
  const ry0 = (ny - sy) >> 1;
  const ry1 = ry0 + sy - 1;
  const gr = rdz.grubosc;

  // Pozycje kolumn: symetrycznie wokół środka rzutu, poza rdzeniem i fasadą.
  const srodki = (nn, co) => {
    const c = (nn - 1) / 2;
    const out = [];
    const kMax = Math.ceil(nn / co) + 1;
    for (let m = -kMax; m <= kMax; m++) {
      const p = Math.floor(c + m * co + 0.5);
      if (p >= gf && p <= nn - 1 - gf) out.push(p);
    }
    return out;
  };
  const kolX = srodki(nx, kol.co);
  const kolY = srodki(ny, kol.co);
  const gruboscKolumny = (k) => Math.max(2, Math.round(kol.dol + (kol.gora - kol.dol) * (k / Math.max(1, nz - 1))));

  const maskiKolumn = new Map();
  const maskaKolumn = (th) => {
    let m = maskiKolumn.get(th);
    if (m) return m;
    m = new Uint8Array(nx * ny);
    const lo = (th - 1) >> 1;
    const hi = th - 1 - lo;
    for (const px of kolX) for (const py of kolY) {
      const x0 = Math.max(gf, px - lo);
      const x1 = Math.min(nx - 1 - gf, px + hi);
      const y0 = Math.max(gf, py - lo);
      const y1 = Math.min(ny - 1 - gf, py + hi);
      // Kolumna przecinająca rdzeń (z marginesem 1 komórki) znika: rdzeń sam niesie.
      if (x1 >= rx0 - 1 && x0 <= rx1 + 1 && y1 >= ry0 - 1 && y0 <= ry1 + 1) continue;
      for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) m[j * nx + i] = 1;
    }
    maskiKolumn.set(th, m);
    return m;
  };

  const klasa = (i, j, k) => {
    const obwX = i < gf || i >= nx - gf;
    const obwY = j < gf || j >= ny - gf;
    const obw = obwX || obwY;
    if (k >= kDachu) return obw ? KIND.FASADA : -1; // attyka
    const kp = k % pietroCo;
    const poziomStropu = kp < gruboscStropu;
    const wObrysieRdzenia = i >= rx0 && i <= rx1 && j >= ry0 && j <= ry1;
    if (wObrysieRdzenia) {
      const sciana = i < rx0 + gr || i > rx1 - gr || j < ry0 + gr || j > ry1 - gr;
      return sciana ? KIND.RDZEN : -1; // wnętrze szybu puste także na poziomie stropu
    }
    if (maskaKolumn(gruboscKolumny(k))[j * nx + i]) return KIND.KOLUMNA;
    if (obw) {
      if (poziomStropu) return KIND.STROP; // krawędź stropu sięga lica: na fasadzie widać piętra jako betonowe pasy
      if (kp >= pietroCo - fas.nadproze) return KIND.FASADA;
      const s = obwX ? j : i;
      return (obwX && obwY) || s % fas.co < gf ? KIND.FASADA : -1; // okna między słupkami
    }
    return poziomStropu ? KIND.STROP : -1;
  };

  let n = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (klasa(i, j, k) >= 0) n++;

  const kondygnacje = [];
  for (let m = 0; m < mStrop; m++) {
    const kOd = m * pietroCo + gruboscStropu;
    const kDo = (m + 1) * pietroCo - 1;
    kondygnacje.push({ m, kOd, kDo, zOd: z0 + kOd * dx, zDo: z0 + (kDo + 1) * dx });
  }

  const scena = zScene(n, dx, (pos, kind, ijk) => {
    let q = 0;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = klasa(i, j, k);
      if (c < 0) continue;
      pos[3 * q] = (i - (nx - 1) / 2) * dx;
      pos[3 * q + 1] = (j - (ny - 1) / 2) * dx;
      pos[3 * q + 2] = z0 + (k + 0.5) * dx;
      ijk[3 * q] = i;
      ijk[3 * q + 1] = j;
      ijk[3 * q + 2] = k;
      kind[q] = c;
      q++;
    }
  }, {
    typ: 'wieza', dx, nx, ny, nz, w: nx * dx, d: ny * dx, h: nz * dx, z0,
    pietroCo, gruboscStropu, liczbaKondygnacji: mStrop, kondygnacje,
    rdzen: { rx0, rx1, ry0, ry1 }, kolumnyX: kolX, kolumnyY: kolY,
    grupy: [{ nazwa: 'wieza', start: 0, n }],
  });
  scena.meta.liczby = zliczKindy(scena.kind);
  return scena;
}

/** Dysk ze skrzynki: dwa pokłady, żebra promieniste i obwodowe, wieniec, pierścień kotwicy (kind 5). */
export function dysk(o = {}) {
  const dx = o.dx ?? 20;
  const R = o.R ?? 900;
  const grubosc = o.grubosc ?? 80;
  const zSrodek = o.zSrodek ?? 0;
  const krokZeber = ((o.krokZeberStopnie ?? 20) * Math.PI) / 180;
  const krokObw = o.krokObwodowy ?? 150;
  const szerKotwicy = Math.max(o.szerKotwicy ?? 30, 1.5 * dx);
  const szerWienca = Math.max(o.szerWienca ?? 40, 2 * dx);
  const polZebra = 0.5 * Math.max(o.gruboscZebra ?? 28.4, 1.42 * dx);

  const nr = Math.ceil(R / dx);
  const nz = Math.max(3, Math.round(grubosc / dx));
  const warstwPokladu = Math.max(1, Math.round((o.gruboscPokladu ?? 20) / dx));

  const klasa = (i, j, k) => {
    const x = i * dx;
    const y = j * dx;
    const r = Math.sqrt(x * x + y * y);
    if (r > R) return -1;
    if (r > R - szerKotwicy) return KIND.KOTWICA;
    if (r > R - szerWienca) return KIND.DYSK; // wieniec na całą wysokość
    if (k < warstwPokladu || k >= nz - warstwPokladu) return KIND.DYSK; // pokłady
    if (r < krokObw - 0.5 * dx) return -1; // środek bez żeber (żebra zbiegłyby się w litą piastę)
    const fi = Math.atan2(y, x);
    const dFi = fi - Math.round(fi / krokZeber) * krokZeber;
    if (r * Math.abs(Math.sin(dFi)) < polZebra) return KIND.DYSK; // żebro promieniste
    const rr = r / krokObw;
    if (Math.abs(rr - Math.round(rr)) * krokObw < polZebra) return KIND.DYSK; // żebro obwodowe
    return -1;
  };

  let n = 0;
  for (let k = 0; k < nz; k++) for (let j = -nr; j <= nr; j++) for (let i = -nr; i <= nr; i++) if (klasa(i, j, k) >= 0) n++;

  const zDol = zSrodek - (nz * dx) / 2;
  const scena = zScene(n, dx, (pos, kind, ijk) => {
    let q = 0;
    for (let k = 0; k < nz; k++) for (let j = -nr; j <= nr; j++) for (let i = -nr; i <= nr; i++) {
      const c = klasa(i, j, k);
      if (c < 0) continue;
      pos[3 * q] = i * dx;
      pos[3 * q + 1] = j * dx;
      pos[3 * q + 2] = zDol + (k + 0.5) * dx;
      ijk[3 * q] = i + nr;
      ijk[3 * q + 1] = j + nr;
      ijk[3 * q + 2] = k;
      kind[q] = c;
      q++;
    }
  }, {
    typ: 'dysk', dx, R, grubosc: nz * dx, nz, zSrodek, zDol, zGora: zDol + nz * dx,
    grupy: [{ nazwa: 'dysk', start: 0, n }],
  });
  scena.meta.liczby = zliczKindy(scena.kind);
  return scena;
}

/** Obrót w miejscu o `stopnie` wokół osi `os` przez punkt `punkt` (ijk bez zmian). */
export function obroc(scena, os, stopnie, punkt = [0, 0, 0]) {
  const dl = Math.sqrt(os[0] * os[0] + os[1] * os[1] + os[2] * os[2]);
  const ux = os[0] / dl;
  const uy = os[1] / dl;
  const uz = os[2] / dl;
  const a = (stopnie * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const t = 1 - c;
  const m = [
    t * ux * ux + c, t * ux * uy - s * uz, t * ux * uz + s * uy,
    t * ux * uy + s * uz, t * uy * uy + c, t * uy * uz - s * ux,
    t * ux * uz - s * uy, t * uy * uz + s * ux, t * uz * uz + c,
  ];
  const p = scena.pos;
  for (let i = 0; i < scena.n; i++) {
    const x = p[3 * i] - punkt[0];
    const y = p[3 * i + 1] - punkt[1];
    const z = p[3 * i + 2] - punkt[2];
    p[3 * i] = m[0] * x + m[1] * y + m[2] * z + punkt[0];
    p[3 * i + 1] = m[3] * x + m[4] * y + m[5] * z + punkt[1];
    p[3 * i + 2] = m[6] * x + m[7] * y + m[8] * z + punkt[2];
  }
  return scena;
}

/** Scala sceny: kolejne grupy (numer w `grupa`, nazwa i zakres w `meta.grupy`). */
export function polacz(sceny, nazwy) {
  let n = 0;
  for (const s of sceny) n += s.n;
  const dx = sceny[0].dx;
  const pos = new Float32Array(3 * n);
  const kind = new Uint8Array(n);
  const ijk = new Int32Array(3 * n);
  const grupa = new Uint8Array(n);
  const vel0 = new Float32Array(3 * n);
  const grupy = [];
  const metaGrup = {};
  let start = 0;
  sceny.forEach((s, g) => {
    if (s.dx !== dx) throw new Error('polacz: różne dx');
    pos.set(s.pos, 3 * start);
    kind.set(s.kind, start);
    ijk.set(s.ijk, 3 * start);
    grupa.fill(g, start, start + s.n);
    if (s.vel0) vel0.set(s.vel0, 3 * start);
    grupy.push({ nazwa: nazwy[g], start, n: s.n });
    metaGrup[nazwy[g]] = s.meta;
    start += s.n;
  });
  return { n, dx, pos, kind, ijk, grupa, vel0, meta: { typ: 'zlozona', dx, grupy, ...metaGrup } };
}

/** Indeksy wokseli grupy o danej nazwie (Int32Array). */
export function indeksyGrupy(scena, nazwa) {
  const g = scena.meta.grupy.find((x) => x.nazwa === nazwa);
  if (!g) return new Int32Array(0);
  const out = new Int32Array(g.n);
  for (let i = 0; i < g.n; i++) out[i] = g.start + i;
  return out;
}

/** Skrót indeksu węzła (front S2): ten sam co w prototypie, żeby wynik był identyczny. */
function hasz(a) {
  let h = Math.imul(a ^ 0x9E3779B1, 0x85EBCA77);
  h ^= h >>> 13;
  h = Math.imul(h, 0xC2B2AE3D);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Lista (indeks, czas) posortowana po czasie; odczyt przedziału (t0, t1] bez alokacji tablicy wynikowej. */
function listaCzasowa(indeksy, czasy) {
  const m = indeksy.length;
  const kolej = new Int32Array(m);
  for (let i = 0; i < m; i++) kolej[i] = i;
  const posort = Array.from(kolej).sort((a, b) => czasy[a] - czasy[b] || indeksy[a] - indeksy[b]);
  const idx = new Int32Array(m);
  const tt = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    idx[i] = indeksy[posort[i]];
    tt[i] = czasy[posort[i]];
  }
  const dolna = (t) => {
    // pierwszy element o czasie > t
    let lo = 0, hi = m;
    while (lo < hi) {
      const s = (lo + hi) >> 1;
      if (tt[s] > t) hi = s;
      else lo = s + 1;
    }
    return lo;
  };
  return {
    m,
    tMin: m ? tt[0] : Infinity,
    usunW(t0, t1) {
      const a = dolna(t0);
      const b = dolna(t1);
      return b > a ? idx.subarray(a, b) : PUSTA;
    },
    indeksy: idx,
    czasy: tt,
  };
}

/** Plan z samym usuwaniem według listy: klatka f usuwa czasy z (t − 1e−9, t + dt − 1e−9]. */
function planUsuwania(id, opis, scena, g, T, lista) {
  return {
    id, opis, scena, g, T,
    zdarzeniaOd: lista.tMin,
    zdarzenia(f, m) {
      const t = f / FPS;
      const l = lista.usunW(t - 1e-9, t + 1 / FPS - 1e-9);
      if (l.length) m.usun(l);
      return l.length;
    },
    czasy: { indeksy: lista.indeksy, t: lista.czasy, rozerwij: new Uint8Array(lista.m), zostawZiarna: false },
  };
}

function wiezaNaGruncie(dx, o) {
  const sc = wieza({ dx, w: 380, d: 420, h: 1340, ...o });
  sc.g = 400;
  sc.gruntZ = 0;
  sc.vel0 = null;
  sc.kluczStatyki = `wieza:${sc.meta.w}x${sc.meta.d}x${sc.meta.h}:dx${dx}`;
  return sc;
}

/** S1 „podcięcie”: stoi 2 s, od t = 2 do 4 s ostrzał z +x usuwa konstrukcję na ~60% szerokości rzutu, 10–18% h. */
export function S1(o = {}) {
  const dx = o.dx ?? 20;
  const sc = wiezaNaGruncie(dx, o.wieza);
  const h = sc.meta.h;
  const szer = sc.meta.w;
  const xMax = szer / 2;
  const glebokosc = 0.6 * szer;
  const zOd = sc.meta.z0 + 0.1 * h;
  const zDo = sc.meta.z0 + 0.18 * h;
  // Nierówny front ostrzału: szum na grubych komórkach (j, k), do tego drobny na woksel.
  const los = prng(o.ziarno ?? 1);
  const nj = sc.meta.ny >> 1;
  const nk = (sc.meta.nz >> 1) + 1;
  const szum = new Float32Array((nj + 1) * nk);
  for (let i = 0; i < szum.length; i++) szum[i] = los();
  const ind = [];
  const cz = [];
  for (let i = 0; i < sc.n; i++) {
    const x = sc.pos[3 * i];
    const z = sc.pos[3 * i + 2];
    if (z < zOd || z > zDo) continue;
    const gl = xMax - (x + dx / 2); // głębokość liczona od lica +x
    if (gl >= glebokosc) continue;
    const s = szum[(sc.ijk[3 * i + 2] >> 1) * (nj + 1) + (sc.ijk[3 * i + 1] >> 1)];
    const t = 2 + 1.7 * (gl / glebokosc) + 0.25 * s + 0.05 * los();
    ind.push(i);
    cz.push(Math.min(4, t));
  }
  return planUsuwania('S1', 'Wieża podcięta: ostrzał z +x, 2–4 s', sc, 400, o.T ?? 9, listaCzasowa(ind, cz));
}

/**
 * S2 „własny ciężar”: t = 2 s, kondygnacja na 65% h, front od środka 0,3 s: 80% węzłów nośnych znika, 20% zostaje gruzem (§ 5.2).
 * front: { tau, rozerw }, czyli szerokość frontu w sekundach i część węzłów rozrywanych zamiast usuwanych.
 */
export function S2(o = {}) {
  const dx = o.dx ?? 20;
  const sc = wiezaNaGruncie(dx, o.wieza);
  const zCel = sc.meta.z0 + 0.65 * sc.meta.h;
  let kond = sc.meta.kondygnacje[0];
  let best = Infinity;
  for (const q of sc.meta.kondygnacje) {
    const b = Math.abs(0.5 * (q.zOd + q.zDo) - zCel);
    if (b < best) {
      best = b;
      kond = q;
    }
  }
  const ind = [];
  for (let i = 0; i < sc.n; i++) {
    const k = sc.ijk[3 * i + 2];
    if (k < kond.kOd || k > kond.kDo) continue;
    if (sc.kind[i] === 0) continue; // na tych warstwach stropu i tak nie ma
    ind.push(i);
  }
  const F = o.front ?? { tau: 0.3, rozerw: 0.2 };
  let rMax = 0;
  for (const i of ind) rMax = Math.max(rMax, Math.sqrt(sc.pos[3 * i] ** 2 + sc.pos[3 * i + 1] ** 2));
  const cz = [];
  const roz = [];
  for (const i of ind) {
    const h = hasz(i + 77);
    const r = Math.sqrt(sc.pos[3 * i] ** 2 + sc.pos[3 * i + 1] ** 2) / rMax;
    cz.push(2 + F.tau * r + 0.05 * (h & 255) / 255);
    roz.push(((h >>> 8) & 255) / 255 < F.rozerw);
  }
  const indT = Int32Array.from(ind);
  const czT = Float64Array.from(cz);
  const rozT = Uint8Array.from(roz, (b) => (b ? 1 : 0));
  const usun = new Int32Array(ind.length);
  const rozerw = new Int32Array(ind.length);
  return {
    id: 'S2',
    opis: `Własny ciężar: t = 2 s, kondygnacja ${kond.m} (z ${kond.zOd}–${kond.zDo}), front ${F.tau} s, ${Math.round(F.rozerw * 100)}% zostaje gruzem`,
    scena: sc,
    g: 400,
    T: o.T ?? 9,
    zdarzeniaOd: 2,
    kondygnacja: kond,
    zdarzenia(f, m) {
      const t = f / FPS;
      const a = t - 1e-9, b = t + 1 / FPS - 1e-9;
      let nu = 0, nr = 0;
      for (let q = 0; q < indT.length; q++) {
        if (czT[q] > a && czT[q] <= b) {
          if (rozT[q]) rozerw[nr++] = indT[q];
          else usun[nu++] = indT[q];
        }
      }
      if (nr) m.rozerwij(rozerw.subarray(0, nr), false);
      if (nu) m.usun(usun.subarray(0, nu));
      return nu;
    },
    czasy: { indeksy: indT, t: czT, rozerwij: rozT, zostawZiarna: false },
  };
}

function przytnij(s, wyb) {
  const ind = [];
  for (let i = 0; i < s.n; i++) if (wyb(s, i)) ind.push(i);
  const n = ind.length;
  const pos = new Float32Array(3 * n), ijk = new Int32Array(3 * n), kind = new Uint8Array(n);
  ind.forEach((o, q) => {
    for (let c = 0; c < 3; c++) {
      pos[3 * q + c] = s.pos[3 * o + c];
      ijk[3 * q + c] = s.ijk[3 * o + c];
    }
    kind[q] = s.kind[o];
  });
  return { ...s, n, pos, ijk, kind, grupa: new Uint8Array(n), meta: { ...s.meta, grupy: [{ nazwa: 'wieza', start: 0, n }] } };
}

/**
 * S3 „przebicie”: dysk w z = 0 z kotwicami na obwodzie, pocisk 150 j. nad pokładem, 2° przechyłu, v = 300 w dół, g = 260, grunt z = −1500.
 * wariant: 'rot30' (demo: pocisk obrócony o 30° wokół z), 'poza' (bez obrotu, h = 900, poza środkiem), 'osm' (rzut ośmiokątny).
 */
export function S3(o = {}) {
  const dx = o.dx ?? 20;
  const wariant = o.wariant ?? 'rot30';
  const ds = dysk({ dx, R: 900, grubosc: 80, zSrodek: 0, ...o.dysk });
  const zSpod = ds.meta.zGora + 150;
  const kolumny = { co: Math.max(3, Math.round(80 / dx)), dol: Math.max(2, Math.round(40 / dx)), gora: Math.max(2, Math.round(40 / dx)) };
  let kw = wieza({ dx, w: 220, d: 220, h: wariant === 'poza' ? 900 : 840, z0: zSpod, kolumny });
  if (wariant === 'osm') kw = przytnij(kw, (s, i) => Math.abs(s.pos[3 * i]) + Math.abs(s.pos[3 * i + 1]) <= 110 * 1.42);
  if (wariant === 'rot30') obroc(kw, [0, 0, 1], 30, [0, 0, 0]);
  obroc(kw, [1, 1, 0], 2, [0, 0, zSpod + kw.meta.h / 2]);
  if (wariant === 'poza') {
    for (let i = 0; i < kw.n; i++) {
      kw.pos[3 * i] += 330;
      kw.pos[3 * i + 1] += 170;
    }
  }
  const v0 = new Float32Array(3 * kw.n);
  for (let i = 0; i < kw.n; i++) v0[3 * i + 2] = -300;
  kw.vel0 = v0;
  const sc = polacz([kw, ds], ['wieza', 'dysk']);
  sc.g = 260;
  // § 10.3: gProj to właściwość budynku, we wszystkich scenach dema 400. gProj: null = budynek liczony na g miejsca (260), jak w proby4/log-R7.txt.
  if (o.gProj !== null) sc.gProj = o.gProj ?? 400;
  sc.gruntZ = -1500;
  sc.kluczStatyki = `S3:${wariant}:dx${dx}`;
  return {
    id: 'S3',
    opis: 'Przebicie dysku R = 900, pocisk 220 × 220, g = 260, grunt z = −1500',
    scena: sc,
    g: 260,
    T: o.T ?? 5,
    zdarzeniaOd: Infinity,
    zdarzenia: () => 0,
    s3: { zGora: ds.meta.zGora, zDol: ds.meta.zDol, zSrodek: ds.meta.zSrodek, v0: 300, przekroj: wariant === 'osm' ? 220 * 220 * 0.83 : 220 * 220 },
    czasy: { indeksy: PUSTA, t: new Float64Array(0), rozerwij: new Uint8Array(0), zostawZiarna: false },
  };
}

/** Opcje końcowe sceny S4 (`s4-opcje-koniec.txt`, § 10.6): cięcie nierówne, siatka pchnięć 4 × 3. */
export const S4_OPCJE = Object.freeze({ J: 120, xs: [190, 130, 70, 10], tau: 0.8, vFrontu: 400, falisty: { A: 90, w: [30, 55], skala: 130 }, zostawZiarna: true, zerujL: true });

/**
 * S4: ta sama wieża, ten sam materiał, różni się tylko miejsce (źródło, grunt, kotwice). Bez opcji: próżnia, Z5.
 * Opcje miejsca: g, gProj, grunt, kotwice, zrodlo, gRef. Plan: tStart, ulamek, ziarnoCiecia, bezCiecia, skalaG [t0, t1, s0, s1] (rampa w biegu).
 */
export function S4(oW = {}) {
  const o = { ...S4_OPCJE, ...oW };
  const dx = o.dx ?? 20;
  const sc = wieza({ dx, w: 380, d: 420, h: o.h ?? 1340 });
  const g = o.g ?? 0;
  sc.g = g;
  if (o.zrodlo) sc.zrodlo = o.zrodlo;
  sc.gProj = o.gProj ?? 400;
  if (o.gRef !== undefined) sc.gRef = o.gRef;
  sc.gruntZ = o.grunt ? 0 : BRAK_GRUNTU;
  sc.kotwice = !!o.kotwice;
  sc.vel0 = null;
  sc.kluczStatyki = `wieza:${sc.meta.w}x${sc.meta.d}x${sc.meta.h}:dx${dx}`;
  const zCel = (o.ulamek ?? 0.5) * sc.meta.h;
  let kond = sc.meta.kondygnacje[0], best = Infinity;
  for (const q of sc.meta.kondygnacje) {
    const b = Math.abs(0.5 * (q.zOd + q.zDo) - zCel);
    if (b < best) { best = b; kond = q; }
  }
  const zc = 0.5 * (kond.zOd + kond.zDo);
  const tS = o.tStart ?? 2;
  const vF = o.vFrontu;
  const los = prng(o.ziarnoCiecia ?? 3);
  const xMax = sc.meta.w / 2;
  const ind = [], cz = [];
  // Nierówne cięcie: powierzchnia zc + A·szum(x, y) o zmiennej grubości (szum wartości na grubej siatce, własny PRNG).
  const fal = o.falisty;
  const NS = 16, sz = new Float32Array(2 * NS * NS);
  for (let q = 0; q < sz.length; q++) sz[q] = los();
  const gl = (t) => t * t * (3 - 2 * t);
  const szum = (x, y, w) => {
    const X = x / fal.skala + 8, Y = y / fal.skala + 8;
    const a = Math.floor(X), b = Math.floor(Y), fx = gl(X - a), fy = gl(Y - b);
    const v = (i, j) => sz[w * NS * NS + ((b + j) & (NS - 1)) * NS + ((a + i) & (NS - 1))];
    return (v(0, 0) * (1 - fx) + v(1, 0) * fx) * (1 - fy) + (v(0, 1) * (1 - fx) + v(1, 1) * fx) * fy;
  };
  const zCiecia = (x, y) => zc + fal.A * (2 * szum(x, y, 0) - 1);
  const grubosc = (x, y) => fal.w[0] + (fal.w[1] - fal.w[0]) * szum(x, y, 1);
  for (let i = 0; i < sc.n && !o.bezCiecia; i++) {
    const x = sc.pos[3 * i], y = sc.pos[3 * i + 1];
    if (Math.abs(sc.pos[3 * i + 2] - zCiecia(x, y)) > grubosc(x, y)) continue;
    ind.push(i);
    cz.push(tS + (xMax - sc.pos[3 * i]) / vF + 0.03 * los());
  }
  const lista = Int32Array.from(ind);
  const czT = Float64Array.from(cz);
  const blasty = [];
  const J = o.J;
  const tau = o.tau;
  const rP = o.rP ?? 320;
  if (J > 0) {
    const ys = o.ys ?? [-140, 0, 140];
    for (const x of o.xs) for (const y of ys) blasty.push({ x, y, z: zCiecia(x, y), t0: tS + (xMax - x) / vF });
  }
  const zerujL = !!o.zerujL;
  const bufor = new Int32Array(lista.length);
  const grupa = [];
  for (let b = 0; b < blasty.length; b++) grupa.push({ x: 0, y: 0, z: 0, rP, Jk: 0 });
  return {
    id: 'S4',
    opis: `Wieża, g = ${g}${o.grunt ? ', grunt' : ''}${o.kotwice ? ', kotwice' : ''}: nierówne cięcie w ${(o.ulamek ?? 0.5) * 100}% h i ${blasty.length} pchnięć`,
    scena: sc,
    g,
    T: o.T ?? 14,
    zdarzeniaOd: tS,
    tS,
    zc,
    pasmo: 0.5 * (kond.zDo - kond.zOd) + 2 * dx,
    blasty,
    kond,
    opcje: o,
    gpu: {
      pchniecia: blasty.map((q) => ({ x: q.x, y: q.y, z: q.z, t0: q.t0, rP, J, tau })),
      zerujL,
      swobodnyG: !o.grunt && !o.kotwice ? g : 0,
      skalaG: o.skalaG ?? null,
    },
    zdarzenia(f, m) {
      const t0 = f / FPS, t1 = t0 + 1 / FPS;
      let nr = 0;
      for (let q = 0; q < lista.length; q++) if (czT[q] > t0 && czT[q] <= t1) bufor[nr++] = lista[q];
      if (nr) m.rozerwij(bufor.subarray(0, nr), !!o.zostawZiarna);
      // Wieża w swobodnym spadku: strzał trafia tam, gdzie wieża jest (Euler półjawny, krok h).
      const dzSw = !o.grunt && !o.kotwice ? -g * (0.5 * t0 * t0 + 0.5 * t0 * m.h) : 0;
      let ile = 0;
      for (let b = 0; b < blasty.length; b++) {
        const q = blasty[b];
        const a = Math.max(t0, q.t0), c = Math.min(t1, q.t0 + tau);
        if (c > a) {
          const w = grupa[ile++];
          w.x = q.x; w.y = q.y; w.z = q.z + dzSw; w.rP = rP; w.Jk = (J * (c - a)) / tau;
        }
      }
      if (ile) m.pchniecia(ile === grupa.length ? grupa : grupa.slice(0, ile), zerujL);
      if (o.skalaG) {
        const [a, b, s0, s1] = o.skalaG;
        const u = Math.min(1, Math.max(0, (t0 - a) / (b - a)));
        m.skalaG(s0 + (s1 - s0) * u);
      }
      return 0;
    },
    czasy: { indeksy: lista, t: czT, rozerwij: new Uint8Array(lista.length).fill(1), zostawZiarna: !!o.zostawZiarna },
  };
}

// Próby odporności (§ 8, § 5.2 scena 4): wieża S1 z innymi listami zdarzeń.

function kolumna1Wyb(sc, i) {
  const q = sc.meta.kondygnacje[2];
  const k = sc.ijk[3 * i + 2];
  return k >= q.kOd && k <= q.kDo && sc.kind[i] === 1 && sc.pos[3 * i] > 60 && sc.pos[3 * i + 1] > 60;
}

function planJednorazowy(id, opis, sc, T, wyb) {
  const ind = [];
  for (let i = 0; i < sc.n; i++) if (wyb(sc, i)) ind.push(i);
  const l = Int32Array.from(ind);
  return {
    id, opis: `${opis}: ${ind.length} węzłów`, scena: sc, g: 400, T,
    zdarzeniaOd: 2,
    zdarzenia(f, m) {
      if (f !== 2 * FPS || !l.length) return 0;
      m.usun(l);
      return l.length;
    },
    czasy: { indeksy: l, t: new Float64Array(l.length).fill(2), rozerwij: new Uint8Array(l.length), zostawZiarna: false },
  };
}

/** t = 2 s znika jedna kolumna w trzeciej kondygnacji. */
export function kolumna1(o = {}) {
  return planJednorazowy('kolumna1', 'Kolumna', wiezaNaGruncie(o.dx ?? 20, o.wieza), o.T ?? 16, kolumna1Wyb);
}

/** t = 2 s znika narożnik (dwa piętra). */
export function naroznik(o = {}) {
  const wyb = (sc, i) => {
    const m = sc.meta;
    const q = m.kondygnacje[2];
    const k = sc.ijk[3 * i + 2];
    return k >= q.kOd && k <= q.kDo + m.pietroCo && sc.pos[3 * i] > 60 && sc.pos[3 * i + 1] > 70;
  };
  return planJednorazowy('naroznik', 'Narożnik', wiezaNaGruncie(o.dx ?? 20, o.wieza), o.T ?? 14, wyb);
}

/** Stanie bez zdarzeń (W1). */
export function stanie(o = {}) {
  return planJednorazowy('stoj60', 'Stanie', wiezaNaGruncie(o.dx ?? 20, o.wieza), o.T ?? 60, () => false);
}

/** Scena 4 z § 5.2: t = 2 kolumna, t = 5 krater r = 60, t = 8 drugi krater r = 60 (bez kopu). */
export function odpornosc(o = {}) {
  const sc = wiezaNaGruncie(o.dx ?? 20, o.wieza);
  const ind = [], cz = [];
  const kr = (i, c, r) => (sc.pos[3 * i] - c[0]) ** 2 + (sc.pos[3 * i + 1] - c[1]) ** 2 + (sc.pos[3 * i + 2] - c[2]) ** 2 < r * r;
  for (let i = 0; i < sc.n; i++) {
    let t = Infinity;
    if (kolumna1Wyb(sc, i)) t = 2;
    if (kr(i, [-190, 0, 650], 60)) t = Math.min(t, 5);
    if (kr(i, [0, -210, 1000], 60)) t = Math.min(t, 8);
    if (t < Infinity) { ind.push(i); cz.push(t); }
  }
  const plan = planUsuwania('odpornosc', `Odporność: ${ind.length} węzłów`, sc, 400, o.T ?? 16, listaCzasowa(ind, cz));
  plan.zdarzeniaOd = 2;
  return plan;
}

/** 32 miejsca mapy kraterów z § 1.2. */
export const MIEJSCA_KRATEROW = (() => {
  const m = [];
  for (const z of [150, 300, 650, 1000]) for (const [x, y] of [[190, 210], [190, -210], [-190, 210], [-190, -210], [190, 0], [-190, 0], [0, 210], [0, -210]]) m.push([x, y, z]);
  return Object.freeze(m);
})();

/**
 * Strzał wg § 2.8, wariant po czasie 0: rdzeń 0,4 r znika, reszta kuli r rozerwana, pchnięcie J przez tau w promieniu rP, z korekcją momentu.
 * proznia: wieża bez gruntu i kotwic, gProj = 400 (ta sama budowa wytrzymałości co przy g = 400).
 */
export function krater(o) {
  const [cx, cy, cz] = o.c;
  const r = o.r, J = o.J, tau = o.tau ?? 0.3, rP = o.rP, rdz = o.rdzen ?? 0.4;
  const sc = wiezaNaGruncie(o.dx ?? 20, o.wieza);
  if (o.proznia) {
    sc.g = 0;
    sc.gProj = 400;
    sc.gruntZ = BRAK_GRUNTU;
    sc.kotwice = false;
  }
  const us = [], ro = [];
  for (let i = 0; i < sc.n; i++) {
    const d2 = (sc.pos[3 * i] - cx) ** 2 + (sc.pos[3 * i + 1] - cy) ** 2 + (sc.pos[3 * i + 2] - cz) ** 2;
    if (d2 < rdz * rdz * r * r) us.push(i);
    else if (d2 < r * r) ro.push(i);
  }
  const lU = Int32Array.from(us), lR = Int32Array.from(ro);
  const grupa = [{ x: cx, y: cy, z: cz, rP, Jk: J / (tau * FPS) }];
  return {
    id: 'krater',
    opis: `Krater r = ${r}, J = ${J}, (${cx}, ${cy}, ${cz})${o.proznia ? ', próżnia' : ''}`,
    scena: sc,
    g: sc.g,
    T: o.T ?? 10,
    zdarzeniaOd: 0,
    usuniete: lU.length,
    rozerwane: lR.length,
    c: o.c,
    gpu: { kratery: [{ f: 0, nos: -1, x: cx, y: cy, z: cz, r, rdzen: rdz, rS: 1, J, tau, rP, usunStojace: false }], zerujL: true },
    zdarzenia(f, m) {
      if (f === 0) {
        m.usun(lU);
        if (lR.length) m.rozerwij(lR, false);
      }
      if (f / FPS < tau) m.pchniecia(grupa, true);
      return f === 0 ? lU.length : 0;
    },
  };
}

/**
 * Plan zdarzeń dla solvera GPU (§ 2.8), same dane: `solver.ustawPlan(planGpu(plan))`.
 * czasy: indeksy, czasy, rodzaj na węzeł (kCzas). pchniecia: { x, y, z, t0, rP, J, tau }, środek znany z budowy.
 * kratery: { f, nos (węzeł-nosiciel) | nos: −1 z x, y, z, r, rdzen, rS, J, tau, rP, dz, usunStojace }, posortowane po f; środek i pchnięcie na GPU, więc plan z wieloma eksplozjami nie potrzebuje nowych buforów.
 * zerujL: korekcja momentu pchnięcia. swobodnyG: środki pchnięć jadą za spadającą wieżą.
 */
export function planGpu(plan) {
  return { czasy: plan.czasy ?? null, pchniecia: [], kratery: [], zerujL: true, swobodnyG: 0, skalaG: null, ...plan.gpu };
}
