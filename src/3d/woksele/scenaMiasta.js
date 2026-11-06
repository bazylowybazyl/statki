// Sceny miasta dema wiązanych wokseli (docs/PLAN-zawalenia-lod-miasto.md § 5, próby 2–4): dzielnica około 500 budynków z miasto.js, M1 „ostrzał z góry”, M2 „wszystko naraz”.
// Moduł czysty: bez three i DOM, działa w wątku budowy, w teście i w Node.
//
// Układ budynku: ukladMiasta(dx) z wieza() (rama, stropy dwuwarstwowe), a poniżej 5 warstw kostka. Materiał: MATERIAL_MIASTA, jeden na scenę. Wyniki próby 1: plan LOD § 5.
//
// AGENT: ijk węzła to WIRTUALNA siatka: każdy budynek ma własne pole, między polami co najmniej 2 puste komórki. Wiązania idą po ijk (budujSasiadow), a lista kontaktów po różnicy ijk rozpoznaje parę związaną (lutKier), więc sąsiedzi przy dx = 20 (ulica krótsza niż 2 komórki) nie mogą być blisko w ijk. Pozycja węzła jest prawdziwa, a siatka haszowa kontaktów idzie po pozycji.
import { wieza, budynekKostka, ukladMiasta, MATERIAL_MIASTA, KIND, prng } from './scena.js';
import { budynkiDzielnicy, siatkaBudynku } from './miasto.js';

export const DX_MIASTA = 10;
/** Pojemność solvera na dzielnicę (z uskokami) wg dx: ?maxWez i ?nKom strony. Bufor listy i kontaktów rośnie tylko na tej stronie, S1–S5 mają domyślne. */
export const POJEMNOSC_MIASTA = Object.freeze({
  20: { maxWez: 26000, nKom: 65536 },
  10: { maxWez: 64000, nKom: 65536 },
  5: { maxWez: 400000, nKom: 524288 },
});

const WARSTWY_RAMY = 5; // plan LOD: poniżej tylu warstw kostka, rama wyszłaby wyższa niż budynek

/** Lista węzłów jednego budynku w jego siatce ijk, korpus i uskok. Wynik: i, j, k, kind w tablicach, nx, ny, nk i klucz: ten sam klucz to ta sama siatka, więc ta sama statyka. */
function wezlyBudynku(b, dx) {
  const s = siatkaBudynku(b, dx);
  const rama = Math.max(1, Math.round(b.h / dx)) >= WARSTWY_RAMY;
  const korpus = rama ? wieza({ dx, w: b.w, d: b.d, h: b.h, ...ukladMiasta(dx) }) : budynekKostka({ dx, w: b.w, d: b.d, h: b.h });
  const m = korpus.meta;
  const I = [], J = [], K = [], R = [];
  const zajete = new Set();
  const klucz = (i, j, k) => (k * 8192 + j) * 8192 + i;
  const dodaj = (i, j, k, r) => {
    const q = klucz(i, j, k);
    if (zajete.has(q)) return;
    zajete.add(q);
    I.push(i); J.push(j); K.push(k); R.push(r);
  };
  for (let q = 0; q < korpus.n; q++) dodaj(korpus.ijk[3 * q], korpus.ijk[3 * q + 1], korpus.ijk[3 * q + 2], korpus.kind[q]);
  // Uskok stoi na stropie dachu, nie na attyce: inaczej między nim a dachem jest pusta warstwa i nic go nie niesie.
  const kDach = rama ? m.liczbaKondygnacji * m.pietroCo + m.gruboscStropu : m.nz;
  let nk = m.nz;
  let kluczU = '';
  const u = s.uskok;
  if (u) {
    const nxU = u.i1 - u.i0 + 1, nyU = u.j1 - u.j0 + 1;
    kluczU = `:${u.i0},${u.i1},${u.j0},${u.j1},${u.nz}`;
    if (u.nz >= WARSTWY_RAMY) {
      const g = wieza({ dx, w: nxU * dx, d: nyU * dx, h: u.nz * dx, ...ukladMiasta(dx), minN: 1, bezRdzenia: true });
      for (let q = 0; q < g.n; q++) dodaj(g.ijk[3 * q] + u.i0, g.ijk[3 * q + 1] + u.j0, g.ijk[3 * q + 2] + kDach, g.kind[q]);
      nk = Math.max(nk, kDach + g.meta.nz);
    } else {
      for (let k = 0; k < u.nz; k++) for (let j = u.j0; j <= u.j1; j++) for (let i = u.i0; i <= u.i1; i++) dodaj(i, j, kDach + k, k === u.nz - 1 ? KIND.STROP : KIND.KOLUMNA);
      nk = Math.max(nk, kDach + u.nz);
    }
  }
  return { I, J, K, R, nx: m.nx, ny: m.ny, nk, klucz: `${m.nx}x${m.ny}x${m.nz}${rama ? 'r' : 'k'}${kluczU}` };
}

/**
 * Dzielnica: węzły wszystkich budynków w jednej grupie „wieza”, węzły z k = 0 na kotwicach (zbuduj), grunt z = 0, g = 400.
 * o: { dx, ziarno, kwartalyU, kwartalyV, promienSzkla }.
 * meta.budynki: { start, n, klucz, x, y, h }: statyka liczy się po budynku (statykaBudynkow w budowa.js), z pamięcią po kluczu.
 */
export function dzielnica(o = {}) {
  const dx = o.dx ?? DX_MIASTA;
  const budynki = o.budynki ?? budynkiDzielnicy({ kwartalyU: o.kwartalyU ?? 11, kwartalyV: o.kwartalyV ?? 10, ziarno: o.ziarno ?? 1, promienSzkla: o.promienSzkla ?? 0.7 }); // o.budynki: gotowa lista, wycinek większego miasta (M3)
  const lista = budynki.map((b) => wezlyBudynku(b, dx));
  let n = 0, mxX = 1, mxY = 1, mxK = 1;
  for (const l of lista) { n += l.I.length; mxX = Math.max(mxX, l.nx); mxY = Math.max(mxY, l.ny); mxK = Math.max(mxK, l.nk); }
  const NV = Math.ceil(Math.sqrt(budynki.length));
  const pX = mxX + 3, pY = mxY + 3;
  if (NV * pX >= 1024 || NV * pY >= 1024 || mxK >= 1024) throw new Error('dzielnica: siatka ijk ponad 10 bitów (slowoIjk w solver.js)');
  const pos = new Float32Array(3 * n), kind = new Uint8Array(n), ijk = new Int32Array(3 * n);
  const zakresy = [];
  let q = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, hMax = 0;
  for (let b = 0; b < budynki.length; b++) {
    const B = budynki[b], l = lista[b];
    const start = q;
    const ox = (b % NV) * pX, oy = Math.floor(b / NV) * pY;
    const mx = (l.nx - 1) / 2, my = (l.ny - 1) / 2;
    for (let e = 0; e < l.I.length; e++, q++) {
      pos[3 * q] = B.x + (l.I[e] - mx) * dx;
      pos[3 * q + 1] = B.y + (l.J[e] - my) * dx;
      pos[3 * q + 2] = (l.K[e] + 0.5) * dx;
      ijk[3 * q] = l.I[e] + ox;
      ijk[3 * q + 1] = l.J[e] + oy;
      ijk[3 * q + 2] = l.K[e];
      kind[q] = l.R[e];
    }
    const h = l.nk * dx;
    hMax = Math.max(hMax, h);
    x0 = Math.min(x0, B.x); x1 = Math.max(x1, B.x); y0 = Math.min(y0, B.y); y1 = Math.max(y1, B.y);
    zakresy.push({ start, n: q - start, klucz: l.klucz, x: B.x, y: B.y, h, hKorpus: B.h, szklo: B.szklo });
  }
  const scena = {
    n, dx, pos, kind, ijk, grupa: new Uint8Array(n), vel0: null, g: 400, gruntZ: 0, kotwice: true,
    meta: { typ: 'miasto', dx, nz: mxK, h: hMax, x0, x1, y0, y1, budynki: zakresy, grupy: [{ nazwa: 'wieza', start: 0, n }] },
  };
  return scena;
}

/** Węzeł budynku najbliższy punktowi: nosiciel krateru. */
function nosiciel(sc, b, x, y, z) {
  const p = sc.pos;
  let best = Infinity, nos = b.start;
  for (let i = b.start; i < b.start + b.n; i++) {
    const d = (p[3 * i] - x) ** 2 + (p[3 * i + 1] - y) ** 2 + (p[3 * i + 2] - z) ** 2;
    if (d < best) { best = d; nos = i; }
  }
  return nos;
}

const R_KRATERU = 28; // pół przekątnej rzutu to 27 j.: kula przy osi tnie cały przekrój
// AGENT: w gęstym środku dzielnicy wieże stoją 13–16 j. od siebie przy wysokości do 480 j., więc to domino: nietrafione padają od gruzu jeszcze długo po ostatniej salwie (plan LOD § 5, wynik prób 2–4). kontaktSzok 0,5 daje przy t = 24 s 161 z 382 nietrafionych, 0,2 około 95, a podłoga wytrzymałości (eMin × 4) nic nie zmienia.
const KLASY_MIASTA = Object.freeze({ strop: { kontaktSzok: 0.2 }, kolumna: { kontaktSzok: 0.2 }, fasada: { kontaktSzok: 0.2 }, rdzen: { kontaktSzok: 0.2 } });
const krater = (o) => ({ rdzen: 0.4, rS: 1, tau: 0.03, dz: 0, usunStojace: true, ...o });

/** Mnożnik barwy budynku w obrazie: szkło chłodniejsze i ciemniejsze, ogród cieplejszy, każdy budynek trochę inny. Sam wygląd, fizyka tego nie czyta. */
function tonBudynku(b) {
  const h = prng(Math.round(Math.abs(b.x) * 7 + Math.abs(b.y) * 131) + 17)();
  const j = 0.82 + 0.34 * h;
  return b.szklo ? [0.8 * j, 0.88 * j, 1.0 * j] : [1.03 * j, 1.0 * j, 0.94 * j];
}

/** Wynik planu wspólny dla M1, M2. kratery po f; trafione: bajt na budynek. */
function planMiasta(id, opis, sc, kratery, trafione, T, cel, nakladka) {
  kratery.sort((a, b) => a.f - b.f);
  const f0 = kratery.length ? kratery[0].f : 0;
  return {
    id, opis, scena: sc, g: 400, T,
    zdarzeniaOd: f0 / 60,
    zdarzenia: () => 0, // tylko GPU
    nakladka: { ...MATERIAL_MIASTA, klasy: KLASY_MIASTA, ...nakladka },
    // zerujL false jak w S5: wiele kraterów naraz w różnych miejscach, a jeden wspólny środek masy pchnięcia nic tu nie znaczy.
    gpu: { zerujL: false, kratery, puscKotwiceF: -1 },
    miasto: {
      budynki: sc.meta.budynki.map((b) => ({ start: b.start, n: b.n, h: b.h, x: b.x, y: b.y, ton: tonBudynku(b) })),
      trafione,
      celBliska: cel,
      trafien: kratery.filter((k) => k.rodz !== 'dach').length,
      budynkow: sc.meta.budynki.length,
    },
    czasy: { indeksy: new Int32Array(0), t: new Float64Array(0), rozerwij: new Uint8Array(0), zostawZiarna: false },
  };
}

/**
 * M1 „Miasto: ostrzał z góry”: stoi 1 s, potem 20 salw po 6 pocisków idzie krzywym pasem przez dzielnicę w 6,5 s.
 * Pocisk: mały krater na dachu, po 3 klatkach główny w 0,2 wysokości, który tnie przekrój (przebijająca głowica, bo krater na samym dachu budynku nie przewróci: W1 krateru 60 j. na wieży, tabela § 8).
 */
export function planM1(o = {}) {
  const sc = dzielnica(o);
  const B = sc.meta.budynki;
  const los = prng(o.ziarnoPlanu ?? 11);
  const salwy = o.salwy ?? 20, naSalwe = o.naSalwe ?? 6;
  const tA = 1, tB = 7.5;
  const szerY = o.szerPasa ?? 170, rozrzutX = 130;
  const trafione = new Uint8Array(B.length);
  const kratery = [];
  const rPs = o.rPSkala ?? 0.72; // zasięg pchnięcia: przy 48 j. kop sięga fasady sąsiada przez ulicę, a przy 35 j. kończy się w ulicy
  // Pas zaczyna się w głębi, w środku czasu przechodzi przy przedniej krawędzi (kamery patrzą od −y), kończy znów w głębi: bliska kamera ma trafienie bez budynków w kadrze.
  const yPasa = (u) => sc.meta.y0 + 0.36 * (sc.meta.y1 - sc.meta.y0) + 0.3 * (sc.meta.y1 - sc.meta.y0) * Math.cos(2 * Math.PI * u);
  let cel = null, celOdl = Infinity;
  for (let s = 0; s < salwy; s++) {
    const u = (s + 0.5) / salwy;
    const xs = sc.meta.x0 + u * (sc.meta.x1 - sc.meta.x0), ys = yPasa(u);
    const tS = tA + (tB - tA) * u;
    for (let q = 0; q < naSalwe; q++) {
      const px = xs + (2 * los() - 1) * rozrzutX, py = ys + (2 * los() - 1) * szerY;
      const f = Math.round(60 * (tS + 0.28 * los()));
      const ox = (2 * los() - 1) * 5, oy = (2 * los() - 1) * 6;
      // Najbliższy budynek jeszcze nietrafiony w promieniu rozrzutu, inaczej najbliższy w ogóle (drugi pocisk w ruinę).
      let bb = 0, naj = Infinity, bbW = 0, najW = Infinity;
      for (let b = 0; b < B.length; b++) {
        const d = (B[b].x - px) ** 2 + (B[b].y - py) ** 2;
        if (d < najW) { najW = d; bbW = b; }
        if (!trafione[b] && d < naj && d < 3600) { naj = d; bb = b; }
      }
      if (!Number.isFinite(naj)) bb = bbW;
      trafione[bb] = 1;
      const b = B[bb], h = b.h;
      if (h >= 60) {
        kratery.push(krater({ f, nos: nosiciel(sc, b, b.x + ox, b.y + oy, h), r: 13, rdzen: 0.5, J: 60, rP: 30, rodz: 'dach' }));
        const zG = Math.max(0.2 * h, 1.5 * sc.dx);
        kratery.push(krater({ f: f + 3, nos: nosiciel(sc, b, b.x + ox, b.y + oy, zG), r: R_KRATERU, J: 160, rP: 48 * rPs, rodz: 'glowna' }));
      } else {
        kratery.push(krater({ f, nos: nosiciel(sc, b, b.x + ox, b.y + oy, 0.4 * h), r: 0.22 * h + 14, J: 120, rP: 42 * rPs, rodz: 'glowna' }));
      }
      // Zbliżenie: trafiony tuż przed t = 4, żeby przy t = 2 stał, przy 4 walił się, a przy 8 leżał. Wybór: jak najbliżej przedniej krawędzi, nie za niski.
      const odl = Math.abs(f / 60 - 3.7) * 400 + (b.y - sc.meta.y0) + (h < 60 ? 2000 : 0);
      if (odl < celOdl) { celOdl = odl; cel = [b.x, b.y, Math.min(70, 0.4 * h)]; }
    }
  }
  return planMiasta('M1', `Miasto: ostrzał z góry, dx = ${sc.dx}, ${sc.n} węzłów, ${B.length} budynków`, sc, kratery, trafione, o.T ?? 10, cel, o.nakladka);
}

/** M2 „Miasto: wszystko naraz”: każdy budynek dostaje krater przy podstawie w ciągu 3 s. Najgorszy przypadek kosztu. */
export function planM2(o = {}) {
  const sc = dzielnica(o);
  const B = sc.meta.budynki;
  const los = prng(o.ziarnoPlanu ?? 13);
  const trafione = new Uint8Array(B.length).fill(1);
  const kratery = [];
  let cel = null, celH = Infinity;
  for (let b = 0; b < B.length; b++) {
    const q = B[b], h = q.h;
    const f = Math.round(60 * (1 + 3 * los()));
    const niski = h < 60;
    const z = niski ? 0.4 * h : Math.max(0.12 * h, 1.5 * sc.dx);
    const r = niski ? 0.22 * h + 14 : R_KRATERU;
    // Co czwarty pełny błysk z kłębem, reszta mały: pierścień pyłu ma sufit, a 480 kłębów po 40 cząstek go przepełnia.
    kratery.push(krater({ f, nos: nosiciel(sc, q, q.x + (2 * los() - 1) * 5, q.y + (2 * los() - 1) * 6, z), r, J: 140, rP: 44 * (o.rPSkala ?? 0.72), rodz: b % 4 === 0 ? 'glowna' : 'mala' }));
    // Zbliżenie: przedni rząd, blisko środka, nie za niski, trafiony około t = 3.
    const w = (q.y - sc.meta.y0) * 2 + 0.25 * Math.abs(q.x) + Math.abs(f / 60 - 3) * 60 + (h < 60 ? 2000 : 0);
    if (w < celH) { celH = w; cel = [q.x, q.y, Math.min(70, 0.4 * h)]; }
  }
  return planMiasta('M2', `Miasto: wszystko naraz, dx = ${sc.dx}, ${sc.n} węzłów, ${B.length} budynków`, sc, kratery, trafione, o.T ?? 10, cel, o.nakladka);
}

/** Rekordów na instancję w `miasto.dalekie.inst` (miastoDalekie.js): cx, cy, pół w, pół d; z0, h, H, tZniszczenia; ox, oy, ziarno, rodzaj; ton r, g, b, rama (1) albo kostka (0) jak w wezlyBudynku. */
export const INST_DALEKIE = 16;
export const T_NIGDY = 1e9;
/** Rodzaj instancji miasta dalekiego: korpus, uskok na dachu, gaszona (budynek liczy solver). */
export const RODZ_DAL = Object.freeze({ KORPUS: 0, USKOK: 1, GASNIE: -1 });

/**
 * M3 „Miasto: tysiące” (plan LOD § 4, tier 0): około 5000 budynków z tej samej reguły co dzielnica. Prostokąt w środku kadru idzie przez solver jak w M1 (około 300 budynków), a reszta to instancje z zawaleniem w shaderze (miastoDalekie.js).
 * Pas ostrzału jest jedną funkcją dla obu tierów: budynek dostaje chwilę z pozycji na pasie, a dopiero potem wiadomo, czy tę chwilę dostanie jako krater solvera, czy jako wpis w buforze instancji.
 * AGENT: tier wybiera się raz, tutaj. Budynek solvera ma instancję z rodzajem GASNIE (lustro bez obrazu), więc A/B i przyszła zmiana tieru to zmiana jednego pola, a nie drugi bufor.
 */
export function planM3(o = {}) {
  const dx = o.dx ?? DX_MIASTA;
  const wszystkie = budynkiDzielnicy({ kwartalyU: o.kwartalyU ?? 40, kwartalyV: o.kwartalyV ?? 27, ziarno: o.ziarno ?? 1, promienSzkla: o.promienSzkla ?? 0.5 });
  // Kamery patrzą od −y: miasto zaczyna się tuż przed kadrem Atlasa, a głębia idzie w +y, inaczej najbliższe rzędy stałyby pod kamerą i zasłaniały wszystko (w grze perspektywa ma sufit, plan LOD § 1).
  const przesY = o.przesY ?? 900;
  for (const b of wszystkie) b.y += przesY;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const b of wszystkie) { x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x); y0 = Math.min(y0, b.y); y1 = Math.max(y1, b.y); }
  const Ly = y1 - y0;
  const yMid = o.yPasa ?? 60; // środek pasa w połowie drogi: tam, gdzie patrzy kamera Atlasa
  const A = 0.2 * Ly;
  const yPasa = (u) => yMid + A + A * Math.cos(2 * Math.PI * u);
  const tA = o.tA ?? 1, tB = o.tB ?? 15;
  const W = (o.szerPasa ?? 0.235) * Ly, trafia = o.trafia ?? 0.85;
  const xS = o.xSolver ?? 400, wS = o.ySolver ?? 800;
  const los = prng(o.ziarnoPlanu ?? 17);
  const czasy = new Float64Array(wszystkie.length);
  const solverowe = [];
  let tierZero = 0, trafZero = 0;
  for (let q = 0; q < wszystkie.length; q++) {
    const b = wszystkie[q];
    const u = (b.x - x0) / (x1 - x0);
    const r1 = los(), r2 = los(), r3 = los();
    const wPasie = Math.abs(b.y - yPasa(u)) < W * (0.85 + 0.3 * r1) && r2 < trafia;
    czasy[q] = wPasie ? tA + (tB - tA) * u + 0.6 * r3 : T_NIGDY;
    if (Math.abs(b.x) < xS && Math.abs(b.y - yMid) < wS) solverowe.push(q);
    else { tierZero++; if (wPasie) trafZero++; }
  }
  const czySolver = new Uint8Array(wszystkie.length);
  for (const q of solverowe) czySolver[q] = 1;
  const sc = dzielnica({ ...o, dx, budynki: solverowe.map((q) => wszystkie[q]) });
  const B = sc.meta.budynki;
  const trafione = new Uint8Array(B.length);
  const kratery = [];
  const rPs = o.rPSkala ?? 0.72;
  let cel = null, celOdl = Infinity;
  for (let s = 0; s < solverowe.length; s++) {
    const t = czasy[solverowe[s]];
    if (t >= T_NIGDY) continue;
    trafione[s] = 1;
    const b = B[s], h = b.h, f = Math.round(60 * t);
    const ox = (2 * los() - 1) * 5, oy = (2 * los() - 1) * 6;
    // Rodzaj „mala” jak w M2: 140 budynków na sekundę z pełnym kłębem przepełniłoby pierścień pyłu, co czwarty dostaje pełny.
    const rodz = s % 4 === 0 ? 'glowna' : 'mala';
    if (h >= 60) {
      kratery.push(krater({ f, nos: nosiciel(sc, b, b.x + ox, b.y + oy, h), r: 13, rdzen: 0.5, J: 60, rP: 30, rodz: 'mala' }));
      kratery.push(krater({ f: f + 3, nos: nosiciel(sc, b, b.x + ox, b.y + oy, Math.max(0.2 * h, 1.5 * sc.dx)), r: R_KRATERU, J: 160, rP: 48 * rPs, rodz }));
    } else {
      kratery.push(krater({ f, nos: nosiciel(sc, b, b.x + ox, b.y + oy, 0.4 * h), r: 0.22 * h + 14, J: 120, rP: 42 * rPs, rodz }));
    }
    const odl = Math.abs(t - 8) * 300 + (b.y - y0) * 0.2 + (h < 60 ? 2000 : 0);
    if (odl < celOdl) { celOdl = odl; cel = [b.x, b.y, Math.min(70, 0.4 * h)]; }
  }
  // Bufor instancji. Rozmiary z siatki solvera przy tym dx (siatkaBudynku), nie z reguły: inaczej stojący sąsiedzi obu tierów różnią się o 2–3 j. na budynek.
  const dane = [];
  for (let q = 0; q < wszystkie.length; q++) {
    const b = wszystkie[q];
    const m = siatkaBudynku(b, dx);
    const hK = m.nz * dx;
    const u = m.uskok;
    const H = hK + (u ? u.nz * dx : 0);
    const ziarno = (q * 2654435 + 12345) % 16777213; // f32 trzyma liczby całkowite do 2^24, a shader robi z tego uint
    const ton = tonBudynku(b);
    const rodzaj = czySolver[q] ? RODZ_DAL.GASNIE : RODZ_DAL.KORPUS;
    dane.push(b.x, b.y, 0.5 * m.nx * dx, 0.5 * m.ny * dx, 0, hK, H, czasy[q], 0, 0, ziarno, rodzaj, ton[0], ton[1], ton[2], m.nz >= WARSTWY_RAMY ? 1 : 0);
    if (u) {
      const ox = (0.5 * (u.i0 + u.i1) - 0.5 * (m.nx - 1)) * dx, oy = (0.5 * (u.j0 + u.j1) - 0.5 * (m.ny - 1)) * dx;
      dane.push(b.x + ox, b.y + oy, 0.5 * (u.i1 - u.i0 + 1) * dx, 0.5 * (u.j1 - u.j0 + 1) * dx, hK, u.nz * dx, H, czasy[q], ox, oy, ziarno, czySolver[q] ? RODZ_DAL.GASNIE : RODZ_DAL.USKOK, ton[0], ton[1], ton[2], u.nz >= WARSTWY_RAMY ? 1 : 0);
    }
  }
  const plan = planMiasta('M3', `Miasto: tysiące, ${wszystkie.length} budynków, solver ${B.length} przy dx = ${sc.dx}, ${sc.n} węzłów`, sc, kratery, trafione, o.T ?? 22, cel, o.nakladka);
  plan.miasto.trafien = trafione.reduce((a, b) => a + b, 0);
  plan.miasto.dalekie = { inst: new Float32Array(dane), n: dane.length / INST_DALEKIE, budynkow: wszystkie.length, tierZero, trafZero, dx, pietroCo: ukladMiasta(dx).pietroCo };
  return plan;
}

/** Stanie dzielnicy (W1): bez zdarzeń. */
export function planStanieMiasta(o = {}) {
  const sc = dzielnica(o);
  return planMiasta('stanieMiasta', `Dzielnica stoi, dx = ${sc.dx}, ${sc.n} węzłów`, sc, [], new Uint8Array(sc.meta.budynki.length), o.T ?? 5, [0, 0, 60]);
}
