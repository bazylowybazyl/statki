// Kratery z misji 1 dla wiązanych wokseli: co dzieje się z wokselami, gdy gra łamie kawałek bazy, zrywa szyję albo zaczyna upadek. Moduł czysty: bez three i DOM, działa w teście.
// Liczby wzięte z planSekwencji w scenaBazy.js (próba B1), a czas względem chwili zdarzenia: tam było jedno nagranie, tu zdarzenia przychodzą z rozgrywki w dowolnej kolejności.
// Układ: X = x bazy, Y = −z bazy, Z = k7HeightToZ(wysokość).
import { k7HeightToZ } from '../haloRing/haloPortK7Layout.js';
import { prng } from './scena.js';

const TAU = Math.PI * 2;
const KUBELEK = 160;
const F = (t) => Math.round(60 * t);
const krater = (o) => ({ rdzen: 0.4, rS: 1, tau: 0.03, dz: 0, usunStojace: true, ...o });

/** w: { n, pos } wypieku, l: createPirateBaseLayout, dx: bok komórki, ziarno: los miejsc, tylko wygląd. */
export function createGrupyGry({ w, l, dx, ziarno = 77 }) {
  const los = prng(ziarno);
  const kubelki = new Map();
  const klucz = (x, y) => (Math.floor(y / KUBELEK) + 8192) * 16384 + (Math.floor(x / KUBELEK) + 8192);
  for (let i = 0; i < w.n; i++) {
    const k = klucz(w.pos[3 * i], w.pos[3 * i + 1]);
    let q = kubelki.get(k);
    if (!q) kubelki.set(k, (q = []));
    q.push(i);
  }

  /** Węzeł najbliższy punktowi w wypieku, −1: nic bliżej niż maxR. Pozycje początkowe: nosiciel krateru i tak jedzie ze swoim węzłem. */
  function szukaj(x, y, z, maxR = 2 * KUBELEK) {
    const zas = Math.ceil(maxR / KUBELEK);
    let naj = maxR * maxR, wyn = -1;
    for (let b = -zas; b <= zas; b++) for (let a = -zas; a <= zas; a++) {
      const q = kubelki.get(klucz(x + a * KUBELEK, y + b * KUBELEK));
      if (!q) continue;
      for (let e = 0; e < q.length; e++) {
        const i = q[e], p = w.pos;
        const d = (p[3 * i] - x) ** 2 + (p[3 * i + 1] - y) ** 2 + (p[3 * i + 2] - z) ** 2;
        if (d < naj) { naj = d; wyn = i; }
      }
    }
    return wyn;
  }

  const Hs = l.habitat;
  const rMin = Math.max(75, 1.9 * dx);
  const dodaj = (lista, t, x, y, z, o, maxR) => {
    const nos = szukaj(x, y, z, maxR);
    if (nos >= 0) lista.push(krater({ f: F(t), nos, ...o }));
  };

  function wiezowiec(id) {
    const h = l.highrises.find((q) => q.id === id);
    const lista = [];
    if (!h) return lista;
    const zNad = k7HeightToZ(l.spec.pier.deckY1);
    const cx = h.x, cy = -h.z;
    for (let s = 0; s < 6; s++) {
      const t = (2.2 * s) / 6;
      for (let q = 0; q < 3; q++) {
        const a = TAU * los();
        const ax = Math.cos(a), ay = Math.sin(a), sk = 0.5 / Math.max(Math.abs(ax) / h.w, Math.abs(ay) / h.d);
        dodaj(lista, t + 0.22 * los(), cx + ax * sk, cy + ay * sk, zNad + 100 + 160 * los(), { r: rMin, J: 120, rP: 170, rodz: q === 0 ? 'glowna' : 'mala' });
      }
    }
    // Na końcu przekrój przez oś, jak kula wieży w S5: bez tego trzon stoi na rdzeniu.
    const R = 0.5 * Math.sqrt(h.w * h.w + h.d * h.d) + 20;
    for (const [dt, dz] of [[0, 120], [0.12, 300]]) dodaj(lista, 2.4 + dt, cx, cy, zNad + dz, { r: R, rdzen: 0.08, rS: 0.3, J: 80, rP: 320, rodz: 'wieza' });
    return lista;
  }

  function cwiartka(id) {
    const q = Hs.quadrants.find((e) => e.id === id);
    const lista = [];
    if (!q) return lista;
    const zS = k7HeightToZ(Hs.floorY), zG = k7HeightToZ(Hs.rimTop), zM = 0.5 * (zS + zG);
    const naLuku = 9;
    for (let s = 0; s < naLuku; s++) {
      const a = q.a0 + ((q.a1 - q.a0) * (s + 0.5)) / naLuku;
      const Rs = Hs.drumR - 0.5 * Hs.wall;
      const t = (2.2 * (s + 0.3 * los())) / naLuku;
      dodaj(lista, t, Rs * Math.cos(a), -Rs * Math.sin(a), zM, { r: 0.5 * (zG - zS) + 40, rdzen: 0.6, J: 150, rP: 300, rodz: s % 2 ? 'mala' : 'glowna' });
      if (s % 2 === 0) dodaj(lista, t + 0.3, Hs.innerR * Math.cos(a), -Hs.innerR * Math.sin(a), zM, { r: 0.5 * (zG - zS) + 20, rdzen: 0.6, J: 100, rP: 240, rodz: 'mala' });
    }
    return lista;
  }

  /** Szyja: najpierw nacięcie od strony upadku (fx, fy, jednostkowy w układzie węzłów), zawias po drugiej stronie puszcza po uderzeniu głowy. Pęd krateru jest zerowy, więc wieża przechyla się przez geometrię nacięcia. */
  function szyja(fx, fy) {
    const lista = [];
    const zCore = k7HeightToZ(Hs.coreTop), zN = zCore + 2 * dx, rN = Hs.neckR;
    const ciecia = [
      [0, 0.9 * rN, zN + 130, 1.05 * rN, 1],
      [0.3, 0.9 * rN, zN + 330, 1.05 * rN, 1],
      [4, -0.9 * rN, zN + 130, 1.3 * rN, 1],
      [4, 0.8 * Hs.coreR, zCore - 150, Hs.coreR, 0.8],
      [4.2, -0.8 * Hs.coreR, zCore - 150, Hs.coreR, 0.8],
    ];
    for (const [t, s, z, r, rdz] of ciecia) dodaj(lista, t, s * fx, s * fy, z, { r, rdzen: rdz, J: 60, rP: 1.3 * r, rodz: 'glowna' });
    return lista;
  }

  /** Jeden sektor dysku. a: kąt bazy, t0: czas od zdarzenia. */
  function sektor(a, t0, lista = []) {
    const R0 = Hs.stemR + dx, R = Hs.discR;
    const kk = TAU / Hs.discSectors;
    const zDol = k7HeightToZ(Hs.discY0), zSr = 0.5 * (zDol + k7HeightToZ(Hs.discY1));
    const rK = R0 + 30;
    const J = 210, Jmala = 90, tauK = 0.3, tauSzew = 0.3, dlW = 340;
    dodaj(lista, t0, rK * Math.cos(a), -rK * Math.sin(a), zSr, { r: Math.max(0.5 * dlW + 60, 2 * dx + 40), rdzen: 0.5, rS: 0, J, rP: 420, tau: tauK, dz: -60, rodz: 'wspornik' });
    const aS = a + 0.5 * kk;
    for (const [fr, rodz, rr, JJ] of [[0.55, 'glowna', 1.2, J], [0.32, 'mala', 1, Jmala], [0.8, 'mala', 1, Jmala]]) {
      const Rg = R0 + fr * (R - R0);
      dodaj(lista, t0 + 0.25 + 0.5 * los(), Rg * Math.cos(aS), -Rg * Math.sin(aS), zSr, { r: rr * Math.max(90, 2.2 * dx), rdzen: 0.2, rS: 0, J: JJ, rP: rodz === 'glowna' ? 640 : 340, tau: tauSzew, dz: (los() < 0.7 ? -1 : 1) * 120 * (0.4 + 0.6 * los()), rodz });
    }
    return lista;
  }

  /** Reszta kawałków (pomosty, zbiorniki, magazyn): łańcuch kraterów wzdłuż dłuższego boku pudła. Pudło skośnego pomostu jest za duże, więc punkt bez węzłów blisko po prostu odpada. */
  function ogolny(c) {
    const lista = [];
    const b = c.box;
    const zS = 0.5 * (k7HeightToZ(b.y0) + k7HeightToZ(b.y1));
    const dX = b.x1 - b.x0, dZ = b.z1 - b.z0, dl = Math.max(dX, dZ);
    const ile = Math.max(2, Math.min(12, Math.ceil(dl / 520)));
    const szeroki = c.kind === 'tank' || c.kind === 'manifold' || c.kind === 'warehouse' || c.kind === 'annex';
    for (let s = 0; s < ile; s++) {
      const u = (s + 0.5) / ile, v = 0.25 + 0.5 * los();
      const x = dX >= dZ ? b.x0 + dX * u : b.x0 + dX * v, zb = dX >= dZ ? b.z0 + dZ * v : b.z0 + dZ * u;
      dodaj(lista, 0.7 * u + 0.15 * los(), x, -zb, zS, { r: (szeroki ? 2.5 : 1.6) * rMin, rdzen: 0.5, J: szeroki ? 180 : 110, rP: szeroki ? 520 : 260, rodz: s % 3 ? 'mala' : 'glowna' }, 420);
    }
    return lista;
  }

  /** Kratery na pęknięcie kawałka gry o tym id. Pusta: kawałek bez obrazu w wokselach. */
  function kawalek(id) {
    const c = l.chunkById?.get(id);
    if (!c) return [];
    if (c.kind === 'highrise') return wiezowiec(id);
    if (c.kind === 'drum') return cwiartka(id);
    // Szyb i głowę prowadzi szyja (zdarzenie voxNeck, a bez niego voxFall): szyja tnie szyb dopiero po przechyle. Cięcie szybu przy pęknięciu H-C wyrzucało płytę pod wieżą, rura szyi wysuwała się w szyb i wieża spadała pionowo.
    if (c.kind === 'core' || c.kind === 'tech') return [];
    if (c.kind === 'disc') {
      const b = c.box;
      return sektor(Math.atan2(0.5 * (b.z0 + b.z1), 0.5 * (b.x0 + b.x1)), 0);
    }
    return ogolny(c);
  }

  /** HP 0 habitatu: sektory dysku po kolei od strony upadku. Kotwice puszcza fala w wGrze.js. */
  function upadek(fx = 0, fy = -1) {
    const lista = [];
    const n = Hs.discSectors, kk = TAU / n;
    const aP = Math.atan2(-fy, fx);
    const s0 = Math.round(aP / kk);
    const kol = [s0];
    for (let e = 1; kol.length < n; e++) { kol.push(s0 + e); if (kol.length < n) kol.push(s0 - e); }
    for (let e = 0; e < n; e++) sektor(kol[e] * kk, (5 * e) / n, lista);
    return { lista };
  }

  return { szukaj, kawalek, szyja, upadek };
}
