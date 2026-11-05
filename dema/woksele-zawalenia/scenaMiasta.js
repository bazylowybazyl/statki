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
  const budynki = budynkiDzielnicy({ kwartalyU: o.kwartalyU ?? 11, kwartalyV: o.kwartalyV ?? 10, ziarno: o.ziarno ?? 1, promienSzkla: o.promienSzkla ?? 0.7 });
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
const krater = (o) => ({ rdzen: 0.4, rS: 1, tau: 0.03, dz: 0, usunStojace: true, ...o });

/** Wynik planu wspólny dla M1, M2. kratery po f; trafione: bajt na budynek. */
function planMiasta(id, opis, sc, kratery, trafione, T, cel) {
  kratery.sort((a, b) => a.f - b.f);
  const f0 = kratery.length ? kratery[0].f : 0;
  return {
    id, opis, scena: sc, g: 400, T,
    zdarzeniaOd: f0 / 60,
    zdarzenia: () => 0, // tylko GPU
    nakladka: MATERIAL_MIASTA,
    // zerujL false jak w S5: wiele kraterów naraz w różnych miejscach, a jeden wspólny środek masy pchnięcia nic tu nie znaczy.
    gpu: { zerujL: false, kratery, puscKotwiceF: -1 },
    miasto: {
      budynki: sc.meta.budynki.map((b) => ({ start: b.start, n: b.n, h: b.h, x: b.x, y: b.y })),
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
        kratery.push(krater({ f: f + 3, nos: nosiciel(sc, b, b.x + ox, b.y + oy, zG), r: R_KRATERU, J: 160, rP: 48, rodz: 'glowna' }));
      } else {
        kratery.push(krater({ f, nos: nosiciel(sc, b, b.x + ox, b.y + oy, 0.4 * h), r: 0.22 * h + 14, J: 120, rP: 42, rodz: 'glowna' }));
      }
      // Zbliżenie: trafiony tuż przed t = 4, żeby przy t = 2 stał, przy 4 walił się, a przy 8 leżał. Wybór: jak najbliżej przedniej krawędzi, nie za niski.
      const odl = Math.abs(f / 60 - 3.7) * 400 + (b.y - sc.meta.y0) + (h < 60 ? 2000 : 0);
      if (odl < celOdl) { celOdl = odl; cel = [b.x, b.y, Math.min(70, 0.4 * h)]; }
    }
  }
  return planMiasta('M1', `Miasto: ostrzał z góry, dx = ${sc.dx}, ${sc.n} węzłów, ${B.length} budynków`, sc, kratery, trafione, o.T ?? 10, cel);
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
    kratery.push(krater({ f, nos: nosiciel(sc, q, q.x + (2 * los() - 1) * 5, q.y + (2 * los() - 1) * 6, z), r, J: 140, rP: 44, rodz: b % 4 === 0 ? 'glowna' : 'mala' }));
    // Zbliżenie: przedni rząd, blisko środka, nie za niski, trafiony około t = 3.
    const w = (q.y - sc.meta.y0) * 2 + 0.25 * Math.abs(q.x) + Math.abs(f / 60 - 3) * 60 + (h < 60 ? 2000 : 0);
    if (w < celH) { celH = w; cel = [q.x, q.y, Math.min(70, 0.4 * h)]; }
  }
  return planMiasta('M2', `Miasto: wszystko naraz, dx = ${sc.dx}, ${sc.n} węzłów, ${B.length} budynków`, sc, kratery, trafione, o.T ?? 10, cel);
}

/** Stanie dzielnicy (W1): bez zdarzeń. */
export function planStanieMiasta(o = {}) {
  const sc = dzielnica(o);
  return planMiasta('stanieMiasta', `Dzielnica stoi, dx = ${sc.dx}, ${sc.n} węzłów`, sc, [], new Uint8Array(sc.meta.budynki.length), o.T ?? 5, [0, 0, 60]);
}
