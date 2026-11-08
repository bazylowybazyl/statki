// Prefraktura obrazu wiązanych wokseli: kawałki „jak beton rozbity młotkiem” i zbrojenie (demo A/B, docs/RAPORT-kawalki-zawalen.md).
// Moduł czysty: bez three, DOM i window. Liczy się przy wypieku, w wątku budowy (budowa.worker.js), z gotowego wypieku `zbuduj`.
//
// Fizyka zostaje wokselowa. Kawałek to sposób rysowania grupy węzłów:
//  • poziom 0: spójne grupy węzłów połączonych wiązaniami WEWNĄTRZ ziarna fizyki (klasa ≥ 6). Ziarno ma wiązania ×6 mocniejsze i bez kruszenia, więc fizyka
//    pęka głównie po granicach ziaren, czyli po granicach kawałków poziomu 0;
//  • poziom 1: większy kawałek poziomu 0 pocięty na 2–12 części różnej wielkości (Voronoi z wagami na węzłach kawałka);
//  • poziom 2: każdy węzeł osobno, jako nieregularna bryłka (sześcian z przesuniętymi narożnikami), z ramą węzła jak dzisiejszy blok.
// Kształt: opis przy zbudujKawalki. Jedna siatka narożników na wszystkich poziomach, więc kawałki różnych poziomów leżą obok siebie bez szpar i zakładek.
import { KIER, ND, STRONA, PARAMETRY, BIT_KOLO } from './budowa.js';

export const BRAK = 0xffffffff;
export const POZIOMY = 3;
/** Domyślne opcje prefraktury. */
export const OPCJE_KAWALKOW = Object.freeze({
  drganie: 0.3,       // los narożnika we wnętrzu kawałka (kształt bryłek poziomu 2), ułamek dx na oś
  drganieL1: 0.16,    // los narożnika na granicy części poziomu 1
  drganieGranicy: 0.08, // los narożnika na granicy kawałka poziomu 0: płaszczyzna przełomu z wygładzenia, los tylko ją chropowaci
  wygladz: 1,         // ile wygładzenia granicy (1: surface nets, 0: schodek z wokseli)
  fala: 0.38,         // spójne przesunięcie narożników granicy (szum o długości falaDl komórek): przełom idzie skośnie przez grubość stropu i słupa
  falaDl: 2.2,
  odlupDl: 1.7,       // długość fali pola odłupania brzegu (komórki): sąsiednie narożniki brzegu idą razem, więc ścianki odłupań są duże i płaskie
  minL1: 8,           // kawałek poziomu 0 od tylu węzłów dzieli się na części poziomu 1
  maksL0: 160,        // większa składowa ziaren dzieli się już na poziomie 0 na części po około celL0 węzłów (koszt najdłuższego wątku kKawalki)
  celL0: 100,
  czescOd: 4,         // rozmiar części poziomu 1 [węzłów]: los z przedziału, osobno na kawałek
  czescDo: 14,
  ziarno: 4242,
});
/** Domyślne zbrojenie: ułamek linii prętów, ciągliwość (ile razy dalej od betonu rozciąga się pręt), mnożnik siły zerwania na rozciąganie. */
export const OPCJE_ZBROJENIA = Object.freeze({ gestosc: 0.4, ciagl: 4, sila: 3 });

function hasz(a) {
  let h = Math.imul(a ^ 0x9E3779B1, 0x85EBCA77);
  h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE3D); h ^= h >>> 16;
  return h >>> 0;
}
const h3 = (a, b, c, e) => hasz(Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791) ^ Math.imul(e, 2654435761));
const los01 = (h) => (h & 0xffffff) / 16777216;
/** Szum wartości 3D (trójliniowy z wygładzeniem) w [0, 1], z hasza węzłów siatki: ten sam punkt daje tę samą wartość. */
function szum3(x, y, z, s) {
  const a = Math.floor(x), b = Math.floor(y), c = Math.floor(z);
  const u = x - a, v = y - b, w = z - c;
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v), sw = w * w * (3 - 2 * w);
  const g = (i, j, k) => los01(h3(a + i, b + j, c + k, s));
  const l = (t, p, q) => p + (q - p) * t;
  return l(sw, l(sv, l(su, g(0, 0, 0), g(1, 0, 0)), l(su, g(0, 1, 0), g(1, 1, 0))), l(sv, l(su, g(0, 0, 1), g(1, 0, 1)), l(su, g(0, 1, 1), g(1, 1, 1))));
}

/** Rama siatki grupy: oś i, j, k w świecie (jednostkowe) i początek komórki (0, 0, 0). S5 obraca i pochyla wieżę, więc siatka nie musi leżeć w osiach świata. */
function ramaGrupy(w, g) {
  const { n, pos, ijk, grupa, nbr, maska, dx } = w;
  const os = [null, null, null];
  for (let i = 0; i < n && !(os[0] && os[1] && os[2]); i++) {
    if (grupa[i] !== g) continue;
    for (let a = 0; a < 3; a++) {
      if (os[a]) continue;
      const j = nbr[STRONA * i + 2 * a];
      if (j < 0 || !((maska[i] >>> (2 * a)) & 1)) continue;
      os[a] = [(pos[3 * j] - pos[3 * i]) / dx, (pos[3 * j + 1] - pos[3 * i + 1]) / dx, (pos[3 * j + 2] - pos[3 * i + 2]) / dx];
    }
  }
  if (!os[0]) os[0] = [1, 0, 0];
  if (!os[1]) os[1] = [0, 1, 0];
  if (!os[2]) os[2] = [os[0][1] * os[1][2] - os[0][2] * os[1][1], os[0][2] * os[1][0] - os[0][0] * os[1][2], os[0][0] * os[1][1] - os[0][1] * os[1][0]];
  let i0 = -1;
  for (let i = 0; i < n; i++) if (grupa[i] === g) { i0 = i; break; }
  const o = [0, 0, 0];
  for (let c = 0; c < 3; c++) o[c] = pos[3 * i0 + c] - dx * (os[0][c] * ijk[3 * i0] + os[1][c] * ijk[3 * i0 + 1] + os[2][c] * ijk[3 * i0 + 2]);
  return { os, o };
}

/** Kawałki poziomów 0 i 1: przynależność, maski wiązań wewnętrznych, listy węzłów. */
function hierarchia(w, op) {
  const { n, nbr, maska, klasaW, pos } = w;
  // Poziom 0: spójne składowe po wiązaniach wnętrza ziarna (klasa ≥ 6), żywych przy wypieku.
  const rodzic = new Int32Array(n);
  for (let i = 0; i < n; i++) rodzic[i] = i;
  const znajdz = (a) => { while (rodzic[a] !== a) { rodzic[a] = rodzic[rodzic[a]]; a = rodzic[a]; } return a; };
  for (let i = 0; i < n; i++) for (let d = 0; d < ND; d++) {
    const ox = STRONA * i + d, j = nbr[ox];
    if (j <= i || !((maska[i] >>> d) & 1) || klasaW[ox] < 6) continue;
    const a = znajdz(i), b = znajdz(j);
    if (a !== b) rodzic[a] = b;
  }
  const dx = w.dx;
  const odl2 = (a, b) => (pos[3 * a] - pos[3 * b]) ** 2 + (pos[3 * a + 1] - pos[3 * b + 1]) ** 2 + (pos[3 * a + 2] - pos[3 * b + 2]) ** 2;
  /**
   * Podział zbioru węzłów na m części różnej wielkości: punkty startowe z najdalszego punktu, przynależność do najbliższego z wagą, potem spójność po wiązaniach w zbiorze.
   * Samotny węzeł dołącza do części, z którą ma najwięcej wiązań. Wynik: listy węzłów części, każda ≥ 2 (węzeł bez sąsiada w zbiorze odpada).
   */
  const podziel = (cz, m, nast) => {
    const ziarna = [cz[Math.floor(nast() * cz.length)]];
    const dmin = new Float64Array(cz.length).fill(Infinity);
    while (ziarna.length < m) {
      const z = ziarna[ziarna.length - 1];
      let best = -1, bi = 0;
      for (let q = 0; q < cz.length; q++) {
        dmin[q] = Math.min(dmin[q], odl2(cz[q], z));
        const sc = dmin[q] * (0.6 + 0.8 * nast());
        if (sc > best) { best = sc; bi = q; }
      }
      if (best <= 0) break;
      ziarna.push(cz[bi]);
    }
    const waga = ziarna.map(() => nast() * 1.6 * dx);
    const czesc = new Int32Array(cz.length);
    for (let q = 0; q < cz.length; q++) {
      let best = Infinity, bz = 0;
      for (let z = 0; z < ziarna.length; z++) {
        const e = Math.sqrt(odl2(cz[q], ziarna[z])) - waga[z];
        if (e < best) { best = e; bz = z; }
      }
      czesc[q] = bz;
    }
    const lok = new Map();
    cz.forEach((i, q) => lok.set(i, q));
    const komp = new Int32Array(cz.length).fill(-1);
    let nk = 0;
    const rozmK = [];
    for (let q = 0; q < cz.length; q++) {
      if (komp[q] >= 0) continue;
      const stos = [q];
      komp[q] = nk;
      let ile = 0;
      while (stos.length) {
        const a = stos.pop();
        ile++;
        const i = cz[a];
        for (let d = 0; d < ND; d++) {
          const j = nbr[STRONA * i + d];
          if (j < 0 || !((maska[i] >>> d) & 1)) continue;
          const b = lok.get(j);
          if (b === undefined || komp[b] >= 0 || czesc[b] !== czesc[a]) continue;
          komp[b] = nk;
          stos.push(b);
        }
      }
      rozmK.push(ile);
      nk++;
    }
    for (let q = 0; q < cz.length; q++) {
      if (rozmK[komp[q]] > 1) continue;
      const i = cz[q];
      const glosy = new Map();
      for (let d = 0; d < ND; d++) {
        const j = nbr[STRONA * i + d];
        const b = j >= 0 && ((maska[i] >>> d) & 1) ? lok.get(j) : undefined;
        if (b === undefined || rozmK[komp[b]] <= 1) continue;
        glosy.set(komp[b], (glosy.get(komp[b]) ?? 0) + 1);
      }
      let best = -1, bk = -1;
      for (const [c, g] of glosy) if (g > best) { best = g; bk = c; }
      if (bk >= 0) { rozmK[komp[q]]--; komp[q] = bk; rozmK[bk]++; }
    }
    const czesci = new Map();
    for (let q = 0; q < cz.length; q++) {
      if (rozmK[komp[q]] < 2) continue;
      let l = czesci.get(komp[q]);
      if (!l) { l = []; czesci.set(komp[q], l); }
      l.push(cz[q]);
    }
    return [...czesci.values()];
  };
  const losy = (ziarno) => { let hh = hasz(ziarno); return () => { hh = hasz(hh); return los01(hh); }; };

  const korzen = new Map();
  const k0 = new Uint32Array(n).fill(BRAK);
  const rozm = new Map();
  for (let i = 0; i < n; i++) { const r = znajdz(i); rozm.set(r, (rozm.get(r) ?? 0) + 1); }
  const skladowe = [];
  for (let i = 0; i < n; i++) {
    const r = znajdz(i);
    if (rozm.get(r) < 2) continue;
    let k = korzen.get(r);
    if (k === undefined) { k = skladowe.length; korzen.set(r, k); skladowe.push([]); }
    skladowe[k].push(i);
  }
  // Wielka składowa (sekcja dysku S5: 870 węzłów) dzieli się już na poziomie 0: kernel liczy kawałek jednym wątkiem, a najdłuższy wątek to czas całego przebiegu.
  const czlonkowie0 = [];
  skladowe.forEach((cz, k) => {
    if (cz.length <= op.maksL0) { czlonkowie0.push(cz); return; }
    for (const c of podziel(cz, Math.ceil(cz.length / op.celL0), losy(k * 104729 + op.ziarno + 1))) czlonkowie0.push(c);
  });
  czlonkowie0.forEach((cz, k) => { for (const i of cz) k0[i] = k; });
  // Poziom 1: części kawałka poziomu 0, różnej wielkości.
  const k1 = new Uint32Array(n).fill(BRAK);
  const czlonkowie1 = [], rodzic1 = [];
  for (let k = 0; k < czlonkowie0.length; k++) {
    const cz = czlonkowie0[k];
    if (cz.length < op.minL1) continue;
    const nast = losy(k * 7919 + op.ziarno);
    const cel = op.czescOd + nast() * (op.czescDo - op.czescOd);
    const m = Math.max(2, Math.min(80, Math.round(cz.length / cel)));
    const czesci = podziel(cz, m, nast);
    // Jedna część na cały kawałek nic nie daje: bez poziomu 1, kawałek od razu rozpada się na bryłki.
    if (czesci.length < 2) continue;
    for (const c of czesci) { czlonkowie1.push(c); rodzic1.push(k); }
  }
  const c1 = czlonkowie1, r1 = rodzic1;
  c1.forEach((cz, id) => { for (const i of cz) k1[i] = id; });
  // Maski wiązań wewnętrznych: bit d, gdy sąsiad w tym samym kawałku i wiązanie żyje przy wypieku.
  const mInt0 = new Uint32Array(n), mInt1 = new Uint32Array(n);
  for (let i = 0; i < n; i++) for (let d = 0; d < ND; d++) {
    const j = nbr[STRONA * i + d];
    if (j < 0 || !((maska[i] >>> d) & 1)) continue;
    if (k0[i] !== BRAK && k0[i] === k0[j]) mInt0[i] |= 1 << d;
    if (k1[i] !== BRAK && k1[i] === k1[j]) mInt1[i] |= 1 << d;
  }
  return { k0, k1, czlonkowie0, czlonkowie1: c1, rodzic1: r1, mInt0, mInt1 };
}

/**
 * Prefraktura sceny. Wynik: tablice dla GPU (obraz: kawalkiObraz.js) i statystyka.
 *  kawWez (4 × n u32): kawałek poziomu 0, poziomu 1 (BRAK: bez), maski wiązań wewnętrznych obu poziomów.
 *  kawInfo (4 × K u32): początek i liczba węzłów w kawCzl, rodzic (poziom 1), poziom | liczba wiązań wewnętrznych << 2. kawRest (4 × K f32): środek w spoczynku.
 *  geometria: pozycja (3 f32: świat w spoczynku na poziomach 0–1, przesunięcie od środka węzła w komórkach na poziomie 2), id (u32: węzeł · 16 + brzeg · 8 + poziom · 2 + przełom),
 *  odlup (4 × snorm8: kierunek odłupania narożnika brzegu, zero poza brzegiem), indeksy.
 *  Normalnej nie ma: ściana jest płaska na trójkąt, normalna z pochodnych we fragmencie.
 *
 * Kształt: siatka narożników sześcianów. Narożnik między zajętymi komórkami przesuwa się, ściana budynku zostaje płaska (narożnik rusza się tylko w osiach,
 * w których nie leży na powierzchni budynku). Na granicy kawałków narożnik idzie w średnią środków krawędzi z różną przynależnością (jak surface nets):
 * schodek z wokseli wychodzi wtedy jako skośna płaszczyzna przełomu. Do tego los, mniejszy na granicy kawałka poziomu 0, większy we wnętrzu (bryłki poziomu 2).
 * Ściana między dwoma węzłami to czworokąt z czterech narożników, rozcięty krótszą przekątną. Te same narożniki i przekątne na wszystkich poziomach,
 * więc kawałki różnych poziomów i bryłki stykają się bez szpar.
 */
export function zbudujKawalki(w, opcje = {}) {
  const op = { ...OPCJE_KAWALKOW, ...opcje };
  const t0 = Date.now();
  const { n, ijk, grupa, dx, pos } = w;
  const H = hierarchia(w, op);
  const { k0, k1 } = H;
  // Etykiety do wygładzania i do ścian: kawałek albo „sam” (n + węzeł), żeby węzeł bez kawałka też miał granicę.
  const et0 = (i) => (k0[i] === BRAK ? n + i : k0[i]);
  const et1 = (i) => (k1[i] === BRAK ? (k0[i] === BRAK ? n + i : 2 * n + k0[i]) : k1[i]);

  const grupy = new Map();
  for (let i = 0; i < n; i++) {
    let g = grupy.get(grupa[i]);
    if (!g) { g = { g: grupa[i], lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9] }; grupy.set(grupa[i], g); }
    for (let c = 0; c < 3; c++) { g.lo[c] = Math.min(g.lo[c], ijk[3 * i + c]); g.hi[c] = Math.max(g.hi[c], ijk[3 * i + c]); }
  }
  for (const g of grupy.values()) {
    g.lo = g.lo.map((x) => x - 1); g.hi = g.hi.map((x) => x + 1);
    g.nx = g.hi[0] - g.lo[0] + 1; g.ny = g.hi[1] - g.lo[1] + 1; g.nz = g.hi[2] - g.lo[2] + 1;
    g.siatka = new Int32Array(g.nx * g.ny * g.nz).fill(-1);
    g.rama = ramaGrupy(w, g.g);
    // Narożnik (a, b, c) leży w punkcie (a − 0,5, b − 0,5, c − 0,5) siatki komórek, między komórkami a − 1 … a.
    g.cnx = g.nx + 1; g.cny = g.ny + 1; g.cnz = g.nz + 1;
    g.nar = new Float64Array(3 * g.cnx * g.cny * g.cnz).fill(NaN);
  }
  const komorka = (g, a, b, c) => {
    const x = a - g.lo[0], y = b - g.lo[1], z = c - g.lo[2];
    if (x < 0 || y < 0 || z < 0 || x >= g.nx || y >= g.ny || z >= g.nz) return -1;
    return g.siatka[(z * g.ny + y) * g.nx + x];
  };
  for (let i = 0; i < n; i++) {
    const g = grupy.get(grupa[i]);
    g.siatka[((ijk[3 * i + 2] - g.lo[2]) * g.ny + ijk[3 * i + 1] - g.lo[1]) * g.nx + ijk[3 * i] - g.lo[0]] = i;
  }

  // Początek siatki w świecie liczony z węzła, nie z grupy: w bazie (scenaBazy.js) każda część ma własne pole wirtualnej siatki ijk, a w świecie leży gdzie indziej.
  // Narożniki i ściany łączą tylko węzły jednej części (między polami są puste komórki), więc węzeł mówi o całym swoim sąsiedztwie.
  const poczatek = (g, i, wy) => {
    const { os } = g.rama;
    for (let c = 0; c < 3; c++) wy[c] = pos[3 * i + c] - dx * (os[0][c] * ijk[3 * i] + os[1][c] * ijk[3 * i + 1] + os[2][c] * ijk[3 * i + 2]);
    return wy;
  };
  const o8 = [0, 0, 0], oV = [0, 0, 0];
  const BIT_KOLA = 1 << BIT_KOLO;
  // Pozycja narożnika (leniwie, raz).
  const id8 = new Int32Array(8);
  const narozIdx = (g, a, b, c) => ((c - g.lo[2]) * g.cny + (b - g.lo[1])) * g.cnx + (a - g.lo[0]);
  const naroznik = (g, a, b, c) => {
    const q = 3 * narozIdx(g, a, b, c);
    if (g.nar[q] === g.nar[q]) return q;
    for (let m = 0; m < 8; m++) id8[m] = komorka(g, a - 1 + (m & 1), b - 1 + ((m >> 1) & 1), c - 1 + ((m >> 2) & 1));
    const baza = [a - 0.5, b - 0.5, c - 0.5];
    // Oś swobodna: w każdej parze komórek różniących się tą osią ta sama zajętość (narożnik nie leży na ścianie budynku prostopadłej do osi).
    const wolna = [true, true, true];
    for (let ax = 0; ax < 3; ax++) {
      const bit = 1 << ax;
      for (let m = 0; m < 8; m++) if (!(m & bit) && (id8[m] >= 0) !== (id8[m | bit] >= 0)) wolna[ax] = false;
    }
    // Wygładzanie po etykietach poziomu 0, a gdy ich granica tędy nie biegnie, po poziomie 1.
    let cel = null, gran = 0;
    for (const et of [et0, et1]) {
      let sx = 0, sy = 0, sz = 0, ile = 0;
      for (let ax = 0; ax < 3; ax++) {
        const bit = 1 << ax;
        for (let m = 0; m < 8; m++) {
          if (m & bit) continue;
          const i = id8[m], j = id8[m | bit];
          if (i < 0 || j < 0 || et(i) === et(j)) continue;
          // Środek krawędzi między środkami komórek m i m | bit.
          const p = [(m & 1) - 0.5, ((m >> 1) & 1) - 0.5, ((m >> 2) & 1) - 0.5];
          p[ax] = 0;
          sx += p[0]; sy += p[1]; sz += p[2]; ile++;
        }
      }
      if (ile) { cel = [sx / ile, sy / ile, sz / ile]; gran = et === et0 ? 1 : 2; break; }
    }
    const h = h3(a, b, c, g.g * 911 + op.ziarno);
    const amp = gran === 1 ? op.drganieGranicy : gran === 2 ? op.drganieL1 : op.drganie;
    // Narożnik na okręgu (wieniec dysku S3 / S5 albo koła habitatu bazy) bez losu: ściana jest krzywa, a przesunięcie wzdłuż niej łamie czworokąty i płaskie cieniowanie daje wgniecenia.
    let iZaj = -1;
    for (let m = 0; m < 8 && iZaj < 0; m++) if (id8[m] >= 0) iZaj = id8[m];
    const { os } = g.rama;
    poczatek(g, iZaj, o8);
    const wx = o8[0] + dx * (os[0][0] * baza[0] + os[1][0] * baza[1] + os[2][0] * baza[2]);
    const wy = o8[1] + dx * (os[0][1] * baza[0] + os[1][1] * baza[1] + os[2][1] * baza[2]);
    const rXY = Math.sqrt(wx * wx + wy * wy);
    let naKole = false, Rk = 0;
    const ko = op.kolo;
    if (ko && g.g === ko.grupa && (id8[0] < 0 || id8[1] < 0 || id8[2] < 0 || id8[3] < 0 || id8[4] < 0 || id8[5] < 0 || id8[6] < 0 || id8[7] < 0) && rXY > ko.R - 0.5 * dx) { naKole = true; Rk = ko.R; }
    // Koła habitatu (opcje.kola, jak ustawKola w wGrze.js): narożnik ściany zewnętrznej (przy pustej komórce) części z bitem koła w pasie ± 0,75 dx od promienia z układu
    // idzie na ten okrąg. Tylko zewnętrzne, więc cały schodek ściany trafia w okrąg (bez zygzaka), a narożniki wnętrza ściany zostają.
    if (!naKole && op.kola && (id8[0] < 0 || id8[1] < 0 || id8[2] < 0 || id8[3] < 0 || id8[4] < 0 || id8[5] < 0 || id8[6] < 0 || id8[7] < 0)) {
      let kolo = false;
      for (let m = 0; m < 8; m++) if (id8[m] >= 0 && (w.flagi[id8[m]] & BIT_KOLA)) kolo = true;
      let naj = 0.75 * dx;
      if (kolo) for (const R of op.kola) if (Math.abs(rXY - R) < naj) { naj = Math.abs(rXY - R); naKole = true; Rk = R; }
    }
    for (let ax = 0; ax < 3; ax++) {
      let x = 0;
      if (wolna[ax] && !naKole) {
        if (cel) x = op.wygladz * cel[ax];
        // Na granicy kawałka spójne pole: sąsiednie narożniki idą w tę samą stronę, więc zamiast drobnego zygzaka wychodzi skośna, falista płaszczyzna przełomu.
        if (gran) x += op.fala * (2 * szum3(a / op.falaDl, b / op.falaDl, c / op.falaDl, g.g * 131 + op.ziarno + 7919 * ax) - 1);
        x += amp * (2 * los01(hasz(h + 17 * ax + 1)) - 1);
        x = Math.max(-0.42, Math.min(0.42, x));
      }
      g.nar[q + ax] = baza[ax] + x;
    }
    // Na okrąg Rk w rzucie XY (wieniec: opcje.kolo grupa, R, jak uRDysk w obraz.js; koła: opcje.kola).
    if (naKole && rXY > 1) {
      const sk = Rk / rXY - 1;
      // Przesunięcie w świecie (wx, wy) · sk na osie siatki (rama ortonormalna).
      const ex = wx * sk / dx, ey = wy * sk / dx;
      for (let ax = 0; ax < 3; ax++) g.nar[q + ax] += os[ax][0] * ex + os[ax][1] * ey;
    }
    return q;
  };

  // Ściany: czworokąt na granicy węzła w kierunku k. Per poziom: zewnętrzna (sąsiad pusty) albo przełom (sąsiad w innym kawałku tego poziomu).
  const poz = [], idA = [], ind = [], odl = [];
  const zakresy = [];
  const vol = [0, 0, 0];
  let wielokatow = 0;
  const q4 = [0, 0, 0, 0], c4 = [null, null, null, null];
  // Narożnik na brzegu kawałka (wokół niego węzeł z innego kawałka tego poziomu): obraz odłupuje go po oderwaniu kawałka.
  const naBrzegu = (g, c, l, etV) => {
    const et = l === 0 ? et0 : et1;
    for (let m = 0; m < 8; m++) {
      const id = komorka(g, c[0] - 1 + (m & 1), c[1] - 1 + ((m >> 1) & 1), c[2] - 1 + ((m >> 2) & 1));
      if (id >= 0 && et(id) !== etV) return 1;
    }
    return 0;
  };
  for (let l = 0; l < POZIOMY; l++) {
    const od = ind.length;
    const wierzch = new Map(); // (kawałek, przełom, narożnik) → indeks wierzchołka
    for (let v = 0; v < n; v++) {
      if (l < 2 && (l === 0 ? k0[v] : k1[v]) === BRAK) continue;
      const g = grupy.get(grupa[v]);
      const { os } = g.rama;
      const o = poczatek(g, v, oV);
      const I = ijk[3 * v], J = ijk[3 * v + 1], Kk = ijk[3 * v + 2];
      const kaw = l === 0 ? k0[v] : l === 1 ? k1[v] : v;
      for (let k = 0; k < 6; k++) {
        const e = KIER[k];
        const u = komorka(g, I + e[0], J + e[1], Kk + e[2]);
        let typ;
        if (u < 0) typ = 0;
        else if (l === 2 || (l === 0 ? et0(u) !== et0(v) : et1(u) !== et1(v))) typ = 1;
        else continue;
        // Narożniki ściany CCW z zewnątrz: osie (u, w) = (ax + 1, ax + 2), kolejność (0,0) (1,0) (1,1) (0,1), dla strony ujemnej odwrotnie.
        const ax = k >> 1, au = (ax + 1) % 3, aw = (ax + 2) % 3;
        const base = [I, J, Kk];
        base[ax] += (k & 1) ? 0 : 1;
        const kol = [[0, 0], [1, 0], [1, 1], [0, 1]];
        for (let m = 0; m < 4; m++) {
          const c = base.slice();
          c[au] += kol[m][0]; c[aw] += kol[m][1];
          q4[(k & 1) ? 3 - m : m] = naroznik(g, c[0], c[1], c[2]);
          c4[(k & 1) ? 3 - m : m] = c;
        }
        const N = g.nar;
        const d02 = (N[q4[0]] - N[q4[2]]) ** 2 + (N[q4[0] + 1] - N[q4[2] + 1]) ** 2 + (N[q4[0] + 2] - N[q4[2] + 2]) ** 2;
        const d13 = (N[q4[1]] - N[q4[3]]) ** 2 + (N[q4[1] + 1] - N[q4[3] + 1]) ** 2 + (N[q4[1] + 2] - N[q4[3] + 2]) ** 2;
        // Krótsza przekątna; remis po haszu nieuporządkowanej pary, więc ściana sąsiada (odwrotna kolejność) tnie się tak samo.
        const p02 = d02 < d13 - 1e-12 || (Math.abs(d02 - d13) <= 1e-12 && (hasz(Math.min(q4[0], q4[2]) * 7 + Math.max(q4[0], q4[2])) & 1));
        const idx = q4.map((qn, m) => {
          const klucz = `${kaw}:${typ}:${qn}`;
          let id = wierzch.get(klucz);
          if (id === undefined) {
            id = poz.length / 3;
            wierzch.set(klucz, id);
            const x = N[qn], y = N[qn + 1], z = N[qn + 2];
            if (l === 2) poz.push(x - I, y - J, z - Kk);
            else for (let c = 0; c < 3; c++) poz.push(o[c] + dx * (os[0][c] * x + os[1][c] * y + os[2][c] * z));
            const brzeg = l < 2 ? naBrzegu(g, c4[m], l, l === 0 ? et0(v) : et1(v)) : 0;
            idA.push(v * 16 + brzeg * 8 + l * 2 + typ);
            // Kierunek odłupania narożnika brzegu (świat, |·| ≤ 1): szum spójny, więc ten sam narożnik w każdej ścianie kawałka i u sąsiada idzie tak samo.
            if (brzeg) {
              const q = [0, 1, 2].map((a2) => 2 * szum3(c4[m][0] / op.odlupDl, c4[m][1] / op.odlupDl, c4[m][2] / op.odlupDl, g.g * 37 + op.ziarno + 104729 * (a2 + 1)) - 1);
              for (let c = 0; c < 3; c++) odl.push(Math.round(127 * Math.max(-1, Math.min(1, os[0][c] * q[0] + os[1][c] * q[1] + os[2][c] * q[2]))));
            } else odl.push(0, 0, 0);
            odl.push(0);
          }
          return id;
        });
        const tri = p02 ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 3], [1, 2, 3]];
        for (const t of tri) {
          ind.push(idx[t[0]], idx[t[1]], idx[t[2]]);
          // Objętość z twierdzenia Gaussa w komórkach (sprawdzenie szczelności).
          const A = q4[t[0]], B = q4[t[1]], C = q4[t[2]];
          vol[l] += (N[A] * (N[B + 1] * N[C + 2] - N[B + 2] * N[C + 1]) - N[A + 1] * (N[B] * N[C + 2] - N[B + 2] * N[C]) + N[A + 2] * (N[B] * N[C + 1] - N[B + 1] * N[C])) / 6;
        }
        wielokatow++;
      }
    }
    zakresy.push([od, ind.length - od]);
  }
  // Wierzchołek z kawałka poziomu 0–1 nosi numer węzła swojej ściany: kawałek bierze się z kawWez tego węzła, a barwa i żar z niego samego.

  const c0 = H.czlonkowie0, c1 = H.czlonkowie1;
  const K = c0.length + c1.length;
  const kawInfo = new Uint32Array(4 * K), kawRest = new Float32Array(4 * K);
  const kawCzl = new Uint32Array(c0.reduce((s, x) => s + x.length, 0) + c1.reduce((s, x) => s + x.length, 0));
  let q = 0;
  const popc = (x) => { let c = 0; for (; x; x &= x - 1) c++; return c; };
  const wpisz = (id, cz, rodzic, poziom) => {
    // .w: poziom (2 bity) i liczba wiązań wewnętrznych liczona z obu końców (próg pęknięcia jako ułamek).
    let nInt = 0;
    for (const i of cz) nInt += popc(poziom === 0 ? H.mInt0[i] : H.mInt1[i]);
    kawInfo[4 * id] = q; kawInfo[4 * id + 1] = cz.length; kawInfo[4 * id + 2] = rodzic; kawInfo[4 * id + 3] = (poziom | (nInt << 2)) >>> 0;
    let x = 0, y = 0, z = 0;
    for (const i of cz) { kawCzl[q++] = i; x += pos[3 * i]; y += pos[3 * i + 1]; z += pos[3 * i + 2]; }
    kawRest[4 * id] = x / cz.length; kawRest[4 * id + 1] = y / cz.length; kawRest[4 * id + 2] = z / cz.length;
  };
  c0.forEach((cz, k) => wpisz(k, cz, BRAK, 0));
  c1.forEach((cz, k) => wpisz(c0.length + k, cz, H.rodzic1[k], 1));
  const kawWez = new Uint32Array(4 * n);
  for (let i = 0; i < n; i++) {
    kawWez[4 * i] = k0[i];
    kawWez[4 * i + 1] = k1[i] === BRAK ? BRAK : c0.length + k1[i];
    kawWez[4 * i + 2] = H.mInt0[i];
    kawWez[4 * i + 3] = H.mInt1[i];
  }
  const rozmiary0 = c0.map((x) => x.length).sort((a, b) => a - b);
  const rozmiary1 = c1.map((x) => x.length).sort((a, b) => a - b);
  const wezlyBez0 = k0.reduce((s, x) => s + (x === BRAK ? 1 : 0), 0);
  return {
    n, K, K0: c0.length, K1: c1.length, kawWez, kawInfo, kawRest, kawCzl,
    geometria: { pozycja: new Float32Array(poz), id: new Uint32Array(idA), odlup: new Int8Array(odl), indeksy: new Uint32Array(ind), zakresy },
    stat: {
      ms: Date.now() - t0, scian: wielokatow, trojkatow: ind.length / 3, wierzcholkow: poz.length / 3,
      trojkatyPoziomow: zakresy.map((z) => z[1] / 3), objetoscPoziomow: vol.map((x) => Math.round(x * 1000) / 1000),
      poziom0: { ile: c0.length, mediana: rozmiary0[rozmiary0.length >> 1] ?? 0, p90: rozmiary0[Math.floor(rozmiary0.length * 0.9)] ?? 0, maks: rozmiary0[rozmiary0.length - 1] ?? 0, wezlowBez: wezlyBez0 },
      poziom1: { ile: c1.length, mediana: rozmiary1[rozmiary1.length >> 1] ?? 0, maks: rozmiary1[rozmiary1.length - 1] ?? 0, wezlowW: c1.reduce((s, x) => s + x.length, 0) },
    },
  };
}

/**
 * Zbrojenie: część wiązań osiowych na granicach kawałków poziomu 0 staje się ciągliwa (klasa + 12, solver z `ciagliwe`).
 * Pręty biegną liniami: strop i dysk w poziomie (x, y), kolumna i rdzeń w pionie. Linia (grupa, oś, dwie pozostałe współrzędne) wchodzi z prawdopodobieństwem `gestosc`.
 * Wynik: pręty do obrazu (i, j, d, hasz), a do fizyki kopie klasaW, Ft, iT i kruszTab z prętami oraz tabela klas 12–17 (`ciagl`). Wypiek `w` zostaje bez zmian.
 */
export function wybierzZbrojenie(w, kaw, opcje = {}) {
  const op = { ...OPCJE_ZBROJENIA, ...opcje };
  const par = w.par ?? PARAMETRY;
  const { n, nbr, maska, kind, ijk, grupa, klasaW, R0 } = w;
  const k0 = new Uint32Array(n);
  for (let i = 0; i < n; i++) k0[i] = kaw.kawWez[4 * i];
  const klasaZ = klasaW.slice(), FtZ = w.Ft.slice(), iTZ = w.iT.slice();
  const druty = [];
  const POZIOME = (k) => k === 0 || k === 4;
  const PIONOWE = (k) => k === 1 || k === 3;
  const ciaglDl = op.ciagl * par.rozcHard; // wydłużenie plastyczne do zerwania, w R0
  for (let i = 0; i < n; i++) for (let d = 0; d < 6; d++) {
    const ox = STRONA * i + d, j = nbr[ox];
    if (j <= i || !((maska[i] >>> d) & 1)) continue;
    if (klasaW[ox] >= 6) continue; // wnętrze ziarna: tu beton i tak trzyma
    if (k0[i] !== BRAK && k0[i] === k0[j]) continue;
    const a = d >> 1;
    const ki = kind[i], kj = kind[j];
    const ok = a < 2 ? POZIOME(ki) && POZIOME(kj) && ki === kj : (PIONOWE(ki) || PIONOWE(kj)) && ki !== 2 && kj !== 2 && ki !== 5 && kj !== 5;
    if (!ok) continue;
    const u = a === 0 ? 1 : 0, v = a === 2 ? 1 : 2;
    const hl = h3(ijk[3 * i + u], ijk[3 * i + v], a, grupa[i] * 31 + 7);
    if (los01(hl) >= op.gestosc) continue;
    const oy = STRONA * j + (d ^ 1);
    klasaZ[ox] = klasaZ[oy] = klasaW[ox] + 12;
    FtZ[ox] = FtZ[oy] = w.Ft[ox] * op.sila;
    iTZ[ox] = iTZ[oy] = 1 / (ciaglDl * R0[ox]);
    druty.push(i, j, d, hasz(i * 18 + d));
  }
  // Tabela klas 12–17: iT dla wiązania osiowego (R0 = dx), iC jak beton, bez kruszenia, twardy limit rozciągania 1 + ciągliwość · rozcHard.
  const iT = new Float32Array(6), iC = new Float32Array(6);
  for (let k = 0; k < 6; k++) {
    iT[k] = 1 / (ciaglDl * w.dx);
    const c = par.klasy[['strop', 'kolumna', 'fasada', 'rdzen', 'dysk', 'kotwica'][k]];
    iC[k] = 1 / (c.dC * w.dx * w.skala);
  }
  const kruszTab = new Float32Array(18);
  kruszTab.set(w.kruszTab.subarray(0, 12));
  return {
    druty: new Uint32Array(druty), ile: druty.length / 4,
    klasaW: klasaZ, Ft: FtZ, iT: iTZ, kruszTab,
    ciagl: { twardy: 1 + ciaglDl, iT, iC, krusz: 0 },
    opcje: op,
  };
}

/**
 * Stan kawałków do pomiaru (harness dema): ile pękło na poziom i z jakiej przyczyny, ile węzłów rysuje który poziom.
 * stan: Float32Array bufora stanu kawałków z GPU (4 × vec4 na kawałek, .w pierwszego: 0 cały, 1 zniknął węzeł, 2 pękły wiązania, 3 odkształcenie), poziom: Uint32Array poziomów węzłów.
 */
export function statystykaKawalkow(kaw, stan, poziom, n) {
  const peklo = [0, 0], wezly = [0, 0, 0], przyczyny = [[0, 0, 0], [0, 0, 0]];
  for (let k = 0; k < kaw.K; k++) {
    const z = Math.round(stan[16 * k + 3]);
    if (z < 1) continue;
    const l = kaw.kawInfo[4 * k + 3] & 3;
    peklo[l]++;
    przyczyny[l][Math.min(3, z) - 1]++;
  }
  for (let i = 0; i < n; i++) wezly[Math.min(2, poziom[i])]++;
  return { K0: kaw.K0, K1: kaw.K1, peklo, wezly, przyczyny };
}

/** Wypiek z prętami do solvera z `ciagliwe`: płytka kopia z podmienionymi tablicami wiązań. */
export function wypiekZeZbrojeniem(w, zbr) {
  return { ...w, klasaW: zbr.klasaW, Ft: zbr.Ft, iT: zbr.iT, kruszTab: zbr.kruszTab, ciagl: zbr.ciagl };
}
