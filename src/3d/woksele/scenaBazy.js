// Scena B1 „Baza piratów” dema wiązanych wokseli (docs/PLAN-zawalenia-lod-miasto.md § 5c): benchmark nowego silnika na prawdziwym układzie misji 1.
// Moduł czysty: bez three i DOM, działa w wątku budowy, w teście i w Node. Wywołanie bez strony:
//   const plan = scenaB1({ dx: 40 }); const { w, g } = zbudujPlan(plan); solver.wczytaj(w); solver.ustawPlan(g);
//
// Wymiary z PIRATE_BASE_SPEC i createPirateBaseLayout, nie przepisane. Układ bazy (x, h, z), h w górę. W demie: X = x, Y = −z, Z = k7HeightToZ(h), czyli obrót bez odbicia (H-S, +z bazy, leży przed kamerą przy −Y), a wysokości nad płaszczyzną gry mają × 0,42 jak w grze („dach około 1200”).
//
// AGENT: wszystkie części leżą na jednej siatce świata (komórka dx), a żadne dwie nie dzielą komórki (Map `zajete`), więc w chwili zero nic się nie przenika. Sąsiednie części dzielą tylko ścianę komórki: odległość dx jest większa niż suma promieni kontaktu (2 · 0,5 · dx · 0,9 · 1,1).
// AGENT: ijk węzła to siatka WIRTUALNA jak w dzielnicy (scenaMiasta.js): każda część ma własne pole, między polami 3 puste komórki, więc wiązań między częściami nie ma, a statyka liczy się po części (statykaBudynkow). Część wisi na swojej dolnej warstwie (k = 0), to są jej kotwice. Dysk to osobna grupa z wypiekiem szwów jak S5.
import { wieza, KIND, prng, szum2, S5_OPCJE, S5_NAKLADKA } from './scena.js';
import { createPirateBaseLayout } from '../portBuildings/pirateBaseLayout.js';
import { k7HeightToZ } from '../haloRing/haloPortK7Layout.js';
import { STRONA, ND } from './budowa.js';

export const DX_BAZY = 40;
/** Pojemność solvera na dx: ?maxWez i ?nKom strony. Węzły z testu tests/wokseleBaza.test.mjs. */
export const POJEMNOSC_BAZY = Object.freeze({
  40: { maxWez: 140000, nKom: 262144 },
  80: { maxWez: 32000, nKom: 65536 },
});

const TAU = Math.PI * 2;
const GRUNT_Z = -3400; // planetoida: tyle mieści podłoga sceny, w grze skała jest 24 km pod płaszczyzną
const G = 400; // PIRATE_BASE_SOLID.gravity, src/game/story/pirateBaseBodies.js

/** Mnożniki barwy części w obrazie, sam wygląd. */
const TON = Object.freeze({
  wiezowiec: [0.92, 0.96, 1.05], reaktor: [0.9, 0.98, 1.06], tech: [1.05, 1.0, 0.92], trzon: [0.85, 0.85, 0.88], dysk: [1.02, 1.0, 0.97],
  pomost: [0.72, 0.72, 0.76], zbiornik: [1.0, 0.86, 0.62], magazyn: [0.82, 0.78, 0.7],
});

/** Części i siatka świata: dodawanie komórek bez nakładania i rzut na pola ijk. */
function createBudowa(dx) {
  const zajete = new Set();
  const klucz = (a, b, c) => (c + 4096) * 67108864 + (b + 4096) * 8192 + (a + 4096);
  const czesci = [];
  const nowa = (nazwa, ton) => { const c = { nazwa, ton, I: [], J: [], K: [], R: [] }; czesci.push(c); return c; };
  const dodaj = (c, a, b, k, r) => {
    const q = klucz(a, b, k);
    if (zajete.has(q)) return;
    zajete.add(q);
    c.I.push(a); c.J.push(b); c.K.push(k); c.R.push(r);
  };
  /** Pętla po komórkach pudła w jednostkach gry. fn(x, y, z) → kind albo −1. Kolejność k, j, i jak w wieza(). */
  const wypelnij = (c, x0, x1, y0, y1, z0, z1, fn) => {
    const a0 = Math.round(x0 / dx), a1 = Math.round(x1 / dx), b0 = Math.round(y0 / dx), b1 = Math.round(y1 / dx), k0 = Math.floor(z0 / dx), k1 = Math.ceil(z1 / dx) - 1;
    for (let k = k0; k <= k1; k++) for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) {
      const r = fn(a * dx, b * dx, (k + 0.5) * dx);
      if (r >= 0) dodaj(c, a, b, k, r);
    }
  };
  return { dx, czesci, nowa, dodaj, wypelnij };
}

/** Pionowy walec o ścianie `sc` (0: lity) między z0 i z1, z dnem i pokrywą grubości `plyta`. */
const rura = (cx, cy, R, sc, z0, z1, plyta, kSc, kPl) => (x, y, z) => {
  if (z < z0 || z > z1) return -1;
  const r = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  if (r > R) return -1;
  if (!sc || r > R - sc) return kSc;
  return plyta && (z < z0 + plyta || z > z1 - plyta) ? kPl : -1;
};

/**
 * Wieżowce miasta habitatu (układ: l.habitat.buildings, 2026-11-11): każdy osobną częścią, wieza() na siatce świata. Boki są równoległe do osi układu, a środek z układu leży na siatce (pirateBaseLayout, city.grid), więc ściany schodzą się z bryłą starej bazy, z której piecze się skóra.
 * Podstawa nad wierzchem tarasu dysku (dysk powstaje po wieżowcach i nie dzieli z nimi komórek). Kotwice w dolnej warstwie: przy uderzeniu wieży puszcza je wGrze (voxBreak z flagą), inaczej resztki stałyby w powietrzu nad wyciętym sektorem dysku. Każdy wieżowiec to też osobny kawałek gry o tym samym id (pula, pęknięcie, kratery).
 */
function budujMiasto(b, l) {
  const dx = b.dx;
  for (const h of l.habitat.buildings) {
    const zB = k7HeightToZ(h.baseY), zD = k7HeightToZ(h.roofY);
    const g = wieza({ dx, w: h.ux ? h.w : h.d, d: h.ux ? h.d : h.w, h: zD - zB });
    const c = b.nowa(h.id, TON.wiezowiec);
    // Dolna warstwa: pierwsza komórka ze środkiem nad wierzchem tarasu, czyli tuż nad pokładem dysku (bez pustej warstwy pod budynkiem).
    const a0 = Math.round(h.x / dx - (g.meta.nx - 1) / 2), b0 = Math.round(-h.z / dx - (g.meta.ny - 1) / 2), k0 = Math.floor(zB / dx - 0.5) + 1;
    for (let q = 0; q < g.n; q++) b.dodaj(c, a0 + g.ijk[3 * q], b0 + g.ijk[3 * q + 1], k0 + g.ijk[3 * q + 2], g.kind[q]);
    c.wiezowiec = { x: a0 * dx + 0.5 * (g.meta.nx - 1) * dx, y: b0 * dx + 0.5 * (g.meta.ny - 1) * dx, w: g.meta.nx * dx, d: g.meta.ny * dx, zB, zD, dzielnica: h.quadrant };
  }
}

/**
 * Reaktory antygrawitacyjne na pomostach (układ: l.antigravs): dzwon emitera pod pokładem (rura rozszerzana ku dołowi, dno z gardzielą), obudowa (ściany, stropy, komora rdzenia), nad nią kolumna rdzenia i pierścień pola na ramionach po przekątnych.
 * Kotwice: dno dzwonu (dolna warstwa części). Podest: pomost rozszerzony do rzutu obudowy, na nim składa się góra. Bez niego gruz przelatuje ramę na wylot aż na planetoidę (tak było z wieżowcem W-1 w pierwszym biegu B1).
 */
function budujReaktory(b, l) {
  const dx = b.dx, P = l.spec.pier;
  const mod3 = (z) => ((Math.floor(z / dx) % 3) + 3) % 3;
  for (const h of l.antigravs) {
    const cx = h.x, cy = -h.z;
    const zB = k7HeightToZ(h.baseY), zBell = k7HeightToZ(P.deckY0 - 120), zFg = k7HeightToZ(h.fgY), zRing = k7HeightToZ(h.ringY), zTop = k7HeightToZ(h.topY);
    const wzdluzX = Math.abs(h.ux) > 0.5;
    const hw = 0.5 * (wzdluzX ? h.w : h.d), hd = 0.5 * (wzdluzX ? h.d : h.w);
    const sc = 2 * dx, R = Math.max(hw, hd, h.ringR + dx, h.bellR) + dx;
    const c = b.nowa(h.id, TON.reaktor);
    b.wypelnij(c, cx - R, cx + R, cy - R, cy + R, zB, zTop, (x, y, z) => {
      const ax = Math.abs(x - cx), ay = Math.abs(y - cy), r = Math.sqrt(ax * ax + ay * ay);
      if (z < zBell) {
        const rb = h.bellR * (0.62 + 0.38 * ((zBell - z) / Math.max(1, zBell - zB)));
        if (r > rb) return -1;
        if (z < zB + dx) return r > 0.4 * h.bellR ? KIND.STROP : -1;
        return r > rb - sc ? KIND.RDZEN : -1;
      }
      if (z < zFg) {
        if (ax > hw || ay > hd) return -1;
        if (ax > hw - sc || ay > hd - sc) return KIND.KOLUMNA;
        if (r <= h.coreR && r > h.coreR - sc) return KIND.RDZEN;
        return z < zBell + dx || z > zFg - dx || mod3(z) === 0 ? KIND.STROP : -1;
      }
      if (r <= 0.62 * h.coreR) return KIND.RDZEN;
      if (Math.abs(z - zRing) <= dx) {
        if (Math.abs(r - h.ringR) <= 0.75 * dx) return KIND.KOLUMNA;
        // Ramię po przekątnej: schodek co najmniej dwóch komórek (≤ dx). Przy < 0,75 dx środek reaktora na siatce (AG-1) dawał łańcuch pojedynczych komórek
        // połączonych tylko wiązaniami ukośnymi i pierścień pola (≈110 węzłów) odpadał sam w pierwszej sekundzie (pomiar 2026-11-12, --scenariusz stoi).
        if (r < h.ringR && Math.abs(ax - ay) <= dx) return KIND.KOLUMNA;
      }
      return -1;
    });
    c.reaktor = { x: cx, y: cy, w: 2 * hw, d: 2 * hd, zB, zD: zTop };
    c.podest = { x: cx, y: cy, pw: hw + dx, pd: hd + dx, pomost: h.pier };
  }
}

/** H-C i H-T jako jedna część: szyb, płyta na szybie, szyja, głowa (talerz, piasta), maszt. Jedna część, bo szyja stoi na szybie wiązaniami: cięcie szybu kraterami to zerwanie „kotwic” szyi z gry. */
function budujWieze(b, Hs, wnetrzeTyp = 0) {
  const dx = b.dx;
  // Wnętrze szybu i szyi: 0 pusta rura (gra), 1 stropy jak w wieżowcu (dwie warstwy na trzy), 2 pełne. Pytanie użytkownika 2026-11-09: wieżowiec
  // podcięty klinem przewraca się w bok, a wieża zawsze siada w dół; wieżowiec jest prawie lity, a rura szyi ma ściankę na dwie komórki i niesie głowę
  // kilka razy cięższą od siebie: przy klinie zostaje cienki łuk ściany, który się miażdży zamiast być zawiasem.
  const wnetrze = (z) => (wnetrzeTyp === 2 ? KIND.RDZEN : wnetrzeTyp === 1 && Math.floor(z / dx) % 3 < 2 ? KIND.STROP : -1);
  const zF = k7HeightToZ(Hs.floorY), zCore = k7HeightToZ(Hs.coreTop), zN1 = k7HeightToZ(Hs.neckY1);
  const zR0 = k7HeightToZ(Hs.ringY0), zR1 = k7HeightToZ(Hs.ringY1), zHead = k7HeightToZ(Hs.headTop), zMast = k7HeightToZ(Hs.mastTop);
  const scSzybu = Math.max(80, 2 * dx), plyta = 2 * dx;
  const scSzyi = Math.max(80, 2 * dx);
  const kat = TAU / 12, polZebra = 0.72 * dx;
  const c = b.nowa('H-C + H-T', TON.tech);
  c.zSzyb = [zF, zCore]; c.zSzyja = [zCore, zR0];
  b.wypelnij(c, -Hs.ringR1, Hs.ringR1, -Hs.ringR1, Hs.ringR1, zF, zMast, (x, y, z) => {
    const r = Math.sqrt(x * x + y * y);
    if (z <= zCore) {
      if (r > Hs.coreR) return -1;
      if (r > Hs.coreR - scSzybu) return KIND.RDZEN;
      return z > zCore - plyta ? KIND.STROP : wnetrze(z);
    }
    if (z < zN1) {
      if (r > Hs.neckR) return -1;
      if (r > Hs.neckR - scSzyi) return KIND.RDZEN;
      return z < zCore + plyta ? KIND.STROP : wnetrze(z);
    }
    if (z < zR0) return r <= Hs.neckR + (Hs.ringR0 - Hs.neckR) * ((z - zN1) / Math.max(1, zR0 - zN1)) && r > Hs.neckR - scSzyi ? KIND.RDZEN : -1; // lejek do talerza
    if (z <= zR1) {
      if (r > Hs.ringR1) return -1;
      if (z < zR0 + plyta || z > zR1 - plyta || r > Hs.ringR1 - plyta) return KIND.STROP;
      if (r <= Hs.neckR && r > Hs.neckR - scSzyi) return KIND.RDZEN; // szyja przechodzi przez talerz do górnego pokładu: inaczej przebija dolny pokład i głowa zsuwa się po niej
      const f = Math.atan2(y, x), dF = f - Math.round(f / kat) * kat;
      return r * Math.abs(Math.sin(dF)) < polZebra ? KIND.KOLUMNA : -1;
    }
    if (z <= zHead) {
      if (r > Hs.headR) return -1;
      return r > Hs.headR - plyta || z > zHead - plyta ? KIND.STROP : -1;
    }
    return r < 1.1 * dx ? KIND.KOLUMNA : -1; // maszt, cieńszego nie ma: węzeł
  });
  return c;
}

/** Trzon (cokół wieży): rura od dysku do placu pod wieżą. zamkniety: z pokrywą i dnem (podstawa wieży stoi na pokrywie, a nie nad pustą rurą). */
function budujTrzon(b, Hs, zamkniety = false) {
  const dx = b.dx, sc = Math.max(80, 2 * dx);
  const zD = k7HeightToZ(Hs.tier2Y), zF = k7HeightToZ(Hs.floorY);
  const c = b.nowa('trzon', TON.trzon);
  b.wypelnij(c, -Hs.stemR, Hs.stemR, -Hs.stemR, Hs.stemR, zD, zF, rura(0, 0, Hs.stemR, sc, zD, zF, zamkniety ? 2 * dx : 0, KIND.RDZEN, KIND.STROP));
}

function budujPomosty(b, l, podesty) {
  const Ps = l.spec.pier, Hs = l.habitat, dx = b.dx;
  const z0 = k7HeightToZ(Ps.deckY0), z1 = k7HeightToZ(Ps.deckY1);
  for (const p of l.piers) {
    const c = b.nowa(p.id, TON.pomost);
    c.pomost = p;
    const xs = [p.ax, p.bx], ys = [-p.az, -p.bz];
    const mg = Math.max(p.halfW, ...podesty.map((d) => d.pd));
    b.wypelnij(c, Math.min(...xs) - mg, Math.max(...xs) + mg, Math.min(...ys) - mg, Math.max(...ys) + mg, z0, z1, (x, y) => {
      const bz = -y, ex = x - p.ax, ez = bz - p.az;
      const s = ex * p.ux + ez * p.uz, q = Math.abs(ex * p.nx + ez * p.nz);
      if (x * x + y * y < Hs.drumR * Hs.drumR) return -1;
      // Pokład wewnątrz obudowy reaktora to wyspa bez drogi do kotwicy (ściany obudowy są inną częścią, reaktory powstają przed pomostami). Jej etykieta
      // 60000 podbijała limit oderwania capEtyk do 90008, a bryła odcięta kraterami była przez 375 s „połączona z kotwicami” i opadała w tłumieniu 40 j./s
      // (wieżowce miasta w grze, raport FABLE-3 2026-11-12). Test w tests/wokseleBaza.test.mjs.
      for (const d of podesty) if (Math.abs(x - d.x) < d.pw - 0.5 * dx && Math.abs(y - d.y) < d.pd - 0.5 * dx) return -1;
      if (s >= 0 && s <= p.len && q <= p.halfW) return KIND.STROP;
      for (const d of podesty) if (d.pomost === p.id && s >= 0 && s <= p.len && Math.abs(x - d.x) <= d.pw && Math.abs(y - d.y) <= d.pd) return KIND.STROP;
      return -1;
    });
  }
}

function budujPaliwo(b, l) {
  const dx = b.dx, F = l.spec.fuel, sc = Math.max(60, 2 * dx), pl = 2 * dx;
  const z0 = k7HeightToZ(F.tankY0), z1 = k7HeightToZ(F.tankY1);
  for (const t of l.tanks) {
    const c = b.nowa(t.id, TON.zbiornik);
    c.zbiornik = { x: t.x, y: -t.z, r: t.r, z0, z1 };
    b.wypelnij(c, t.x - t.r, t.x + t.r, -t.z - t.r, -t.z + t.r, z0, z1, rura(t.x, -t.z, t.r, sc, z0, z1, pl, KIND.RDZEN, KIND.STROP));
  }
  const m = l.manifold, cb = l.chunkById.get(m.chunk).box;
  const c = b.nowa(m.id, TON.zbiornik);
  c.skrzynia = { x: m.x, y: -m.z, z0: k7HeightToZ(cb.y0), z1: k7HeightToZ(cb.y1) };
  b.wypelnij(c, m.x - m.w / 2, m.x + m.w / 2, -m.z - m.d / 2, -m.z + m.d / 2, c.skrzynia.z0, c.skrzynia.z1, skrzynia(m.x, -m.z, m.w, m.d, c.skrzynia.z0, c.skrzynia.z1, 2 * dx, 2 * dx));
}

/** Pudło bez dna: ściany `sc`, dach `pl`. */
const skrzynia = (cx, cy, w, d, z0, z1, sc, pl) => (x, y, z) => {
  const ax = Math.abs(x - cx), ay = Math.abs(y - cy);
  if (ax > w / 2 || ay > d / 2 || z < z0 || z > z1) return -1;
  if (z > z1 - pl) return KIND.STROP;
  return ax > w / 2 - sc || ay > d / 2 - sc ? KIND.KOLUMNA : -1;
};

function budujMagazyn(b, l) {
  const dx = b.dx, W = l.warehouse, cb = l.chunkById.get('M-1').box;
  const z0 = k7HeightToZ(cb.y0), z1 = k7HeightToZ(W.roofY);
  const c = b.nowa('M-1', TON.magazyn);
  c.skrzynia = { x: W.x, y: -W.z, z0, z1 };
  b.wypelnij(c, W.x - W.w / 2, W.x + W.w / 2, -W.z - W.d / 2, -W.z + W.d / 2, z0, z1, skrzynia(W.x, -W.z, W.w, W.d, z0, z1, Math.max(W.wall, 2 * dx), 2 * dx));
  // Plac kontenerów M-2 (warehouseYard w pirateBaseScene.js): płyta i rząd stosów. Wysokości stosów równe, bo barwę i tak daje wypiek skóry.
  const A = W.annex;
  const cA = b.nowa('M-2', TON.magazyn);
  const zP0 = k7HeightToZ(-110), zP1 = k7HeightToZ(-50), zSt = k7HeightToZ(200);
  b.wypelnij(cA, A.x - A.w / 2, A.x + A.w / 2, -A.z - A.d / 2, -A.z + A.d / 2, zP0, zP1, () => KIND.STROP);
  for (let x = A.x - A.w / 2 + 90; x < A.x + A.w / 2 - 60; x += 130) {
    for (let z = A.z - A.d / 2 + 110; z < A.z + A.d / 2 - 80; z += 230) {
      b.wypelnij(cA, x - 55, x + 55, -z - 100, -z + 100, zP1, zSt, () => KIND.KOLUMNA);
    }
  }
}

/**
 * Dysk z tierami: rzut pierścieniowy stemR…discR, skrzynka z dwóch pokładów i żeber jak dysk() w S5, górny pokład schodami po tierach, kotwice w łukach przy trzonie (po jednym na sektor).
 * Węzły trzymane przez kotwicę nie ważą (budowa, gałąź „dysk”), jak w S5.
 */
function budujDysk(b, Hs, o) {
  const dx = b.dx;
  const zDol = k7HeightToZ(Hs.discY0), zT0 = k7HeightToZ(Hs.discY1), zT1 = k7HeightToZ(Hs.tier1Y), zT2 = k7HeightToZ(Hs.tier2Y);
  const R = Hs.discR, R0 = Hs.stemR + dx; // o jedną komórkę od trzonu
  const gora = (r) => (r < Hs.tier2R ? zT2 : r < Hs.tier1R ? zT1 : zT0);
  const krokZ = (o.krokZeber * Math.PI) / 180, krokO = o.krokObwodowy, polZ = 0.5 * Math.max(28.4, 1.42 * dx);
  const szerW = Math.max(40, 2 * dx), szerK = Math.max(60, 2 * dx);
  const kk = TAU / Hs.discSectors, dlA = (0.5 * o.wspornikDl) / R0;
  const k0 = Math.floor(zDol / dx);
  const c = b.nowa('dysk D-1…8', TON.dysk);
  b.wypelnij(c, -R, R, -R, R, zDol, zT2, (x, y, z) => {
    const r = Math.sqrt(x * x + y * y);
    if (r > R || r < R0) return -1;
    const zG = gora(r);
    if (z > zG) return -1;
    if (r < R0 + szerK) {
      const a = Math.atan2(-y, x), dA = a - Math.round(a / kk) * kk;
      if (Math.abs(dA) <= dlA) return KIND.KOTWICA; // jeden łuk na sektor, na środku sektora
      return KIND.DYSK;
    }
    if (r > R - szerW) return KIND.DYSK; // wieniec
    if (Math.floor(z / dx) === k0 || z > zG - dx) return KIND.DYSK; // pokłady
    if (Math.abs(r - Hs.tier1R) < 0.75 * dx || Math.abs(r - Hs.tier2R) < 0.75 * dx) return KIND.DYSK; // stopnie
    // Tarasy miasta (nad płytą dysku, od 2026-11-12 wysokie): co drugie żebro promieniowe i bez żeber obwodowych, niosą je ściany stopni i pokład. Pełna kratownica w tarasach to kilkanaście tysięcy węzłów więcej.
    const taras = z > zT0;
    const f = Math.atan2(y, x), nrZ = Math.round(f / krokZ), dF = f - nrZ * krokZ;
    if (r * Math.abs(Math.sin(dF)) < polZ && (!taras || nrZ % 2 === 0)) return KIND.DYSK;
    if (taras) return -1;
    const rr = r / krokO;
    return Math.abs(rr - Math.round(rr)) * krokO < polZ ? KIND.DYSK : -1;
  });
  c.dysk = { R, R0, zDol, zT2, k0 };
  return c;
}

/** Części habitatu zbudowane z kół wokół jego osi: bloki przy tych kołach dociąga obraz (uKola w obraz.js). */
const CZESCI_KOL = new Set(['H-C + H-T', 'trzon', 'dysk D-1…8']);

/** Promienie kół habitatu dla obrazu (ustawKola, najwyżej 12): rogi bloków części z bitem koła trafiają w te okręgi. */
export const kolaHabitatu = (Hs) => [Hs.neckR, Hs.coreR, Hs.headR, Hs.ringR0, Hs.ringR1, Hs.stemR, Hs.tier2R, Hs.tier1R, Hs.discR];

/**
 * Składa części w scenę: pola ijk na półce, grupa „wieza” z meta.budynki i grupa „dysk”.
 * Pozycja węzła to środek komórki świata, więc bez lewej ani prawej strony: część z nx parzystym nie ma przesunięcia o pół komórki względem sąsiadów.
 */
function zloz(b, czDysk, l) {
  const { dx, czesci } = b;
  let n = 0;
  for (const c of czesci) n += c.I.length;
  const pos = new Float32Array(3 * n), kind = new Uint8Array(n), ijk = new Int32Array(3 * n), grupa = new Uint8Array(n), kola = new Uint8Array(n);
  const zakresy = [];
  const zapisane = czesci.filter((c) => c !== czDysk);
  let oi = 0, oj = 0, wiersz = 0, q = 0;
  const zapisz = (c, g, ax, ay) => {
    const a0 = Math.min(...c.I), b0 = Math.min(...c.J), k0 = Math.min(...c.K);
    const start = q;
    for (let e = 0; e < c.I.length; e++, q++) {
      pos[3 * q] = c.I[e] * dx; pos[3 * q + 1] = c.J[e] * dx; pos[3 * q + 2] = (c.K[e] + 0.5) * dx;
      ijk[3 * q] = c.I[e] - a0 + ax; ijk[3 * q + 1] = c.J[e] - b0 + ay; ijk[3 * q + 2] = c.K[e] - k0;
      kind[q] = c.R[e]; grupa[q] = g; kola[q] = CZESCI_KOL.has(c.nazwa) ? 1 : 0;
    }
    c.start = start; c.n = q - start;
    return { nx: Math.max(...c.I) - a0 + 1, ny: Math.max(...c.J) - b0 + 1, nk: Math.max(...c.K) - k0 + 1 };
  };
  for (const c of zapisane) {
    const nx = Math.max(...c.I) - Math.min(...c.I) + 1;
    if (oi + nx >= 1000) { oi = 0; oj += wiersz + 3; wiersz = 0; }
    const m = zapisz(c, 0, oi, oj);
    oi += m.nx + 3;
    wiersz = Math.max(wiersz, m.ny);
    c.klucz = `B1:${c.nazwa}:${dx}`;
    zakresy.push({ start: c.start, n: c.n, klucz: c.klucz });
  }
  const nW = q;
  const mD = zapisz(czDysk, 1, 0, 0);
  if (oj + wiersz >= 1024) throw new Error('scenaB1: siatka ijk ponad 10 bitów (slowoIjk w solver.js)');
  return {
    n, dx, pos, kind, ijk, grupa, kola, vel0: null, g: G, gruntZ: GRUNT_Z, kotwice: true,
    meta: {
      typ: 'baza', dx, budynki: zakresy, wieza: { baza: true },
      // AGENT: R = 1e9 to brak dociągania rogów do koła w obrazie (uRDysk w obraz.js): to działa na KAŻDY węzeł dalej od osi niż R, więc przy prawdziwym promieniu pomosty i zbiorniki poleciałyby do koła. Promień dysku jest w c.dysk i w o.R wypieku szwów.
      dysk: { typ: 'dysk', dx, R: 1e9, nz: mD.nk },
      grupy: [{ nazwa: 'wieza', start: 0, n: nW }, { nazwa: 'dysk', start: nW, n: n - nW }],
    },
  };
}

/** Sektory dysku po kącie bazy z zakrzywioną granicą i podsekcje Voronoi: odpowiednik sekcjeS5, ale D-1…8 jak w grze, nie 17 komórek. Tablice na węzeł dysku. */
/** Części środka bazy: wieża z podstawą, trzon, dysk i wieżowce miasta. Reszta (pomosty, reaktory, zbiorniki, magazyn) to boki. */
const czescSrodka = (nazwa) => nazwa === 'H-C + H-T' || nazwa === 'trzon' || nazwa === 'dysk D-1…8' || /^B-\d+$/.test(nazwa);

/** Liny i spoiny (LINY_B1). */
export const LINY_B1 = Object.freeze({
  // Spoiny: między stykającymi się częściami boków (wspólna ściana komórki), najwyżej tyle na parę części, rozłożone po styku.
  spoinNaPare: 12, spoinaRozc: 2, spoinaK: 0.3,
  // Mosty: część boku bez styku z innym bokiem (zbiorniki, magazyn) łączy się liną przez szczelinę z najbliższym bokiem, promieniem po osiach do mostDl komórek.
  mostNaCzesc: 6, mostDl: 10,
  // Liny widoczne: od pomostów przy krawędzi miasta do dysku pod spodem. Dwa rzędy (r krawędzi miasta + rzad) po naPomost / 2 w poprzek pomostu, koniec przy dysku cofnięty ku osi o wglab.
  naPomost: 10, rzad: [60, 320], wglab: 220, linaRozc: 0.6, linaK: 0.12, zwis: 1.03,
  // Wzmocnienie wiązań węzła ciągniętego (koniec b): zaczep nie wyrywa się z części przy pierwszym szarpnięciu.
  mocZaczepu: 10,
});

/**
 * Liny bazy (prośba użytkownika 2026-11-12: „widzę szpary, pusta przestrzeń ciągnie w dół — trzeba dodać coś, co trzyma, jakieś druty”). Części nie mają między sobą wiązań, więc środek
 * nie mógł pociągnąć boków przy upadku. Spoiny: krótkie, niewidoczne, między stykającymi się częściami boków (pomost–reaktor, pomost–pomost, pomost–zbiornik). Liny widoczne: od
 * spodu pomostów przy krawędzi miasta do dysku pod nimi (krótkie skośne do tarasu, długie pionowe do wieńca). Wynik: [{ a, b, L0, rozcMax, k, widac }]: a — koniec od strony środka
 * (solver go nie rusza), b — ciągnięty, każdy b raz. Węzły po indeksach sceny, położenie komórki: x = I·dx, y = J·dx, z = (K + 0,5)·dx.
 */
function planLin(sc, czesci, Hs, dx, o = LINY_B1) {
  const pos = sc.pos, n = sc.n;
  const czesc = new Int32Array(n).fill(-1);
  const rCz = czesci.map((c, k) => {
    let sx = 0, sy = 0;
    for (let i = c.start; i < c.start + c.n; i++) { czesc[i] = k; sx += pos[3 * i]; sy += pos[3 * i + 1]; }
    return Math.sqrt((sx / Math.max(1, c.n)) ** 2 + (sy / Math.max(1, c.n)) ** 2);
  });
  const bok = czesci.map((c) => !czescSrodka(c.nazwa));
  const klucz = (I, J, K) => ((K + 2048) * 8192 + (J + 4096)) * 8192 + (I + 4096);
  const siatka = new Map();
  const ijk = (i) => [Math.round(pos[3 * i] / dx), Math.round(pos[3 * i + 1] / dx), Math.round(pos[3 * i + 2] / dx - 0.5)];
  for (let i = 0; i < n; i++) { const [I, J, K] = ijk(i); siatka.set(klucz(I, J, K), i); }
  const dl = (a, b) => Math.sqrt((pos[3 * a] - pos[3 * b]) ** 2 + (pos[3 * a + 1] - pos[3 * b + 1]) ** 2 + (pos[3 * a + 2] - pos[3 * b + 2]) ** 2);
  const liny = [], uzyteB = new Set();
  const dodaj = (a, b, rozcMax, k, widac, zwis = 1) => {
    if (uzyteB.has(b) || a === b) return false;
    uzyteB.add(b);
    liny.push({ a, b, L0: dl(a, b) * zwis, rozcMax, k, widac });
    return true;
  };

  // Spoiny: pary węzłów sąsiednich komórek (6 ścian) z dwóch różnych części boków.
  const pary = new Map();
  const SCIANY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let i = 0; i < n; i++) {
    const p = czesc[i];
    if (p < 0 || !bok[p]) continue;
    const [I, J, K] = ijk(i);
    for (const [di, dj, dk] of SCIANY) {
      const j = siatka.get(klucz(I + di, J + dj, K + dk));
      if (j === undefined) continue;
      const q = czesc[j];
      if (q < 0 || q === p || !bok[q]) continue;
      const kl = Math.min(p, q) * 4096 + Math.max(p, q);
      let l = pary.get(kl);
      if (!l) pary.set(kl, (l = []));
      l.push([i, j]);
    }
  }
  for (const l of pary.values()) {
    const krok = Math.max(1, l.length / o.spoinNaPare);
    for (let e = 0; e < l.length && liny.length < 100000; e += krok) {
      const [i, j] = l[Math.floor(e)];
      // a od strony środka: część bliżej osi habitatu ciągnie dalszą.
      const [a, b] = rCz[czesc[i]] <= rCz[czesc[j]] ? [i, j] : [j, i];
      dodaj(a, b, o.spoinaRozc, o.spoinaK, false);
    }
  }

  // Liny widoczne: pomosty, które dochodzą do krawędzi miasta, do dysku pod nimi.
  const dysk = czesci.findIndex((c) => c.nazwa === 'dysk D-1…8');
  const najblizszyDysku = (x, y, z) => {
    let best = -1, bd = Infinity;
    const [I0, J0, K0] = [Math.round(x / dx), Math.round(y / dx), Math.round(z / dx - 0.5)];
    for (let dk = -4; dk <= 4; dk++) for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) {
      const j = siatka.get(klucz(I0 + di, J0 + dj, K0 + dk));
      if (j === undefined || czesc[j] !== dysk) continue;
      const d = (pos[3 * j] - x) ** 2 + (pos[3 * j + 1] - y) ** 2 + (pos[3 * j + 2] - z) ** 2;
      if (d < bd) { bd = d; best = j; }
    }
    return best;
  };
  // Najwyższy węzeł dysku pod punktem (x, y): wierzch tarasu albo wieńca.
  const wierzchDysku = (x, y) => {
    const [I0, J0] = [Math.round(x / dx), Math.round(y / dx)];
    let best = -1, bz = -Infinity;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) for (let K = -60; K <= 10; K++) {
      const j = siatka.get(klucz(I0 + di, J0 + dj, K));
      if (j === undefined || czesc[j] !== dysk) continue;
      if (pos[3 * j + 2] > bz) { bz = pos[3 * j + 2]; best = j; }
    }
    return best;
  };
  if (dysk >= 0) czesci.forEach((c, k) => {
    if (!bok[k]) return;
    // Węzły spodu części przy krawędzi miasta: r w rzędzie, najniższa warstwa w kolumnie.
    let rMin = Infinity;
    for (let i = c.start; i < c.start + c.n; i++) rMin = Math.min(rMin, Math.hypot(pos[3 * i], pos[3 * i + 1]));
    if (rMin > Hs.drumR + 2 * dx) return;
    for (const dr of o.rzad) {
      const kand = [];
      for (let i = c.start; i < c.start + c.n; i++) {
        const r = Math.hypot(pos[3 * i], pos[3 * i + 1]);
        if (Math.abs(r - (Hs.drumR + dr)) > 0.6 * dx) continue;
        const [I, J, K] = ijk(i);
        const pod = siatka.get(klucz(I, J, K - 1));
        if (pod !== undefined && czesc[pod] === k) continue; // nie spód
        kand.push(i);
      }
      // W poprzek pomostu: po kącie wokół osi habitatu.
      kand.sort((x, y) => Math.atan2(pos[3 * x + 1], pos[3 * x]) - Math.atan2(pos[3 * y + 1], pos[3 * y]));
      const ile = Math.min(kand.length, Math.round(o.naPomost / o.rzad.length));
      for (let e = 0; e < ile; e++) {
        const b = kand[Math.round(((e + 0.5) * kand.length) / ile - 0.5)];
        const x = pos[3 * b], y = pos[3 * b + 1], r = Math.hypot(x, y);
        const f = (r - o.wglab) / r;
        const w = wierzchDysku(x * f, y * f);
        const a = w >= 0 ? w : najblizszyDysku(x * f, y * f, pos[3 * b + 2] - 400);
        if (a >= 0) dodaj(a, b, o.linaRozc, o.linaK, true, o.zwis);
      }
    }
  });
  // Mosty: sieć lin rośnie od środka. Część boku, której nie łączy z siecią żadna spoina ani lina (zbiorniki, magazyn), dostaje liny przez szczelinę do najbliższej
  // części, która już jest w sieci (promień po osiach siatki do mostDl komórek). Widoczne, bo inaczej szczelinę ciągnęłaby „pusta przestrzeń”. a po stronie sieci.
  const OSIE = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  // Pary przez szczeliny, raz dla wszystkich boków i w obu kierunkach: promień z węzła boku po osi do pierwszego napotkanego węzła innej części boku.
  const przezSzczeline = new Map();
  for (let i = 0; i < n; i++) {
    const p = czesc[i];
    if (p < 0 || !bok[p]) continue;
    const [I, J, K] = ijk(i);
    for (const [di, dj, dk] of OSIE) for (let t = 2; t <= o.mostDl; t++) {
      const j = siatka.get(klucz(I + t * di, J + t * dj, K + t * dk));
      if (j === undefined) continue;
      const q = czesc[j];
      if (q !== p && bok[q]) {
        const kl = p * 4096 + q;
        let l = przezSzczeline.get(kl);
        if (!l) przezSzczeline.set(kl, (l = []));
        l.push([i, j, t]);
      }
      break;
    }
  }
  const sasiedzi = czesci.map(() => new Set());
  const polacz = (l) => { const p = czesc[l.a], q = czesc[l.b]; sasiedzi[p].add(q); sasiedzi[q].add(p); };
  liny.forEach(polacz);
  const wSieci = new Set();
  const rozlej = () => {
    wSieci.clear();
    const stos = czesci.map((c, k) => k).filter((k) => !bok[k] && sasiedzi[k].size);
    for (const k of stos) wSieci.add(k);
    while (stos.length) for (const q of sasiedzi[stos.pop()]) if (!wSieci.has(q)) { wSieci.add(q); stos.push(q); }
  };
  rozlej();
  for (let przebieg = 0; przebieg < czesci.length; przebieg++) {
    let dodane = 0;
    czesci.forEach((c, k) => {
      if (!bok[k] || wSieci.has(k)) return;
      // Najbliższa część w sieci: pary z tej części do niej i z niej do tej części (b zawsze po stronie k).
      let kand = [];
      for (const q of wSieci) {
        if (!bok[q]) continue;
        for (const [i, j, t] of przezSzczeline.get(k * 4096 + q) ?? []) kand.push([j, i, t]);
        for (const [i, j, t] of przezSzczeline.get(q * 4096 + k) ?? []) kand.push([i, j, t]);
      }
      if (!kand.length) return;
      kand.sort((x, y) => x[2] - y[2]);
      kand = kand.filter((e) => e[2] <= kand[0][2] + 2);
      const ile = Math.min(kand.length, o.mostNaCzesc);
      for (let e = 0; e < ile; e++) {
        const [a, b] = kand[Math.round(((e + 0.5) * kand.length) / ile - 0.5)];
        if (dodaj(a, b, o.linaRozc, o.linaK, true, o.zwis)) { polacz(liny[liny.length - 1]); dodane++; }
      }
    });
    if (!dodane) break;
    rozlej();
  }

  // Widoczne pierwsze: obraz rysuje liny 0 … nWidocznych − 1 (linyObraz.js), solver liczy wszystkie.
  return [...liny.filter((l) => l.widac), ...liny.filter((l) => !l.widac)];
}

function sektoryDysku(sc, nW, nD, o, ileSek, los) {
  const n1 = szum2(los), n2 = szum2(los), n3 = szum2(los), n4 = szum2(los);
  const seg = new Int32Array(nD), pod = new Int32Array(nD), wewnSek = new Float32Array(ileSek);
  const wezly = Array.from({ length: ileSek }, () => []);
  const X2 = new Float32Array(nD), Y2 = new Float32Array(nD);
  const kk = TAU / ileSek;
  for (let q = 0; q < nD; q++) {
    const i = nW + q, x = sc.pos[3 * i], y = sc.pos[3 * i + 1];
    const a = Math.atan2(-(y + o.warpA * n2(x / o.warpS1, y / o.warpS1)), x + o.warpA * n1(x / o.warpS1, y / o.warpS1));
    let s = Math.round(a / kk) % ileSek;
    if (s < 0) s += ileSek;
    seg[q] = s;
    wezly[s].push(q);
    X2[q] = x + 110 * n3(x / 280, y / 280);
    Y2[q] = y + 110 * n4(x / 280, y / 280);
  }
  let nPod = 0;
  for (let s = 0; s < ileSek; s++) {
    const lista = wezly[s];
    wewnSek[s] = o.wewnTab[Math.floor(los() * o.wewnTab.length) % o.wewnTab.length];
    const ile = o.podSektor[0] + Math.floor(los() * (o.podSektor[1] - o.podSektor[0] + 1));
    const pk = [];
    for (let e = 0; e < ile && lista.length; e++) {
      let bx = 0, by = 0, naj = -1;
      for (let c = 0; c < o.kandydatow; c++) {
        const w = lista[Math.floor(los() * lista.length) % lista.length];
        let d = 1e18;
        for (const v of pk) d = Math.min(d, (v[0] - X2[w]) ** 2 + (v[1] - Y2[w]) ** 2);
        if (d > naj) { naj = d; bx = X2[w]; by = Y2[w]; }
      }
      pk.push([bx, by]);
    }
    for (const w of lista) {
      let best = Infinity, t = 0;
      for (let e = 0; e < pk.length; e++) { const d = (X2[w] - pk[e][0]) ** 2 + (Y2[w] - pk[e][1]) ** 2; if (d < best) { best = d; t = e; } }
      pod[w] = nPod + t;
    }
    nPod += pk.length;
  }
  return { seg, nSeg: ileSek, pod, nPod, wewnSek };
}

const krater = (o) => ({ rdzen: 0.4, rS: 1, tau: 0.03, dz: 0, usunStojace: true, ...o });

/** Węzeł części najbliższy punktowi: nosiciel krateru. */
function nosiciel(sc, c, x, y, z) {
  const p = sc.pos;
  let best = Infinity, nos = c.start;
  for (let i = c.start; i < c.start + c.n; i++) {
    const d = (p[3 * i] - x) ** 2 + (p[3 * i + 1] - y) ** 2 + (p[3 * i + 2] - z) ** 2;
    if (d < best) { best = d; nos = i; }
  }
  return nos;
}

/**
 * Sekwencja jak w misji, same dane. Liczby czasu w T. Kraterem steruje się tylko z planu: środek jedzie z węzłem, martwy nosiciel to pominięcie.
 * AGENT: pchnięcie krateru ma zerowy pęd (odjęta średnia zbioru), więc wieży nie da się przechylić kopem. Przechył bierze się z geometrii: dwa kratery wycinają stronę −y nasady szyi (ku wyłomowi) i wieża pada ku nacięciu jak drzewo, a strona +y zostaje zawiasem. Kratery nie mogą ruszać płyty na szybie: bez niej dół szyi wysuwa się i wpada w pusty szyb, a głowa spada pionowo (zrzuty bok1–bok3, t = 10–13).
 */
function planSekwencji(sc, cz, l, o, los) {
  const dx = sc.dx, Hs = l.habitat;
  const T = o.czasy;
  const rMin = Math.max(75, 1.9 * dx);
  const kr = [];
  const F = (t) => Math.round(60 * t);

  // Salwy w dolną część wieżowca. Pociski na obwodzie w 100–260 j. nad pokładem, na końcu przekrój przez oś, tak jak kula wieży w S5.
  const salwy = (c, [tA, tB], zNad) => {
    const w = c.wiezowiec, ileS = Math.round((tB - tA) / 0.5);
    for (let s = 0; s < ileS; s++) {
      const tS = tA + ((tB - tA - 0.2) * s) / ileS;
      for (let q = 0; q < 3; q++) {
        const a = TAU * los();
        const cx = Math.cos(a), cy = Math.sin(a), sk = 0.5 / Math.max(Math.abs(cx) / w.w, Math.abs(cy) / w.d);
        const px = w.x + cx * sk, py = w.y + cy * sk, pz = zNad + 100 + 160 * los();
        kr.push(krater({ f: F(tS + 0.22 * los()), nos: nosiciel(sc, c, px, py, pz), r: rMin, J: 120, rP: 170, rodz: q === 0 ? 'glowna' : 'mala' }));
      }
    }
    const R = 0.5 * Math.sqrt(w.w * w.w + w.d * w.d) + 20;
    for (const [dt, dz] of [[0, 120], [0.12, 300]]) kr.push(krater({ f: F(tB - 0.25 + dt), nos: nosiciel(sc, c, w.x, w.y, zNad + dz), r: R, rdzen: 0.08, rS: 0.3, J: 80, rP: 320, rodz: 'wieza' }));
  };
  // Ćwiartka H-S miasta: najpierw wieżowiec zewnętrzny i wewnętrzny na osi, potem reszta (wyłom), tak jak ostrzał z jednej strony w misji.
  const zPokladu = k7HeightToZ(l.spec.pier.deckY1);
  const hs = l.habitat.buildings.filter((q) => q.quadrant === 'H-S');
  const zewn = hs.filter((q) => q.ring === 1), wewn = hs.filter((q) => q.ring === 0);
  const pierwsze = [zewn[zewn.length >> 1], wewn[wewn.length >> 1]];
  salwy(cz.get(pierwsze[0].id), T.w1, zPokladu);
  salwy(cz.get(pierwsze[1].id), T.w2, zPokladu);
  const reszta = hs.filter((q) => !pierwsze.includes(q));
  const krokW = (T.wylom[1] - T.wylom[0]) / Math.max(1, reszta.length);
  reszta.forEach((q, e) => salwy(cz.get(q.id), [T.wylom[0] + e * krokW, T.wylom[0] + (e + 1) * krokW + 0.4], zPokladu));

  // Nasada szyi: najpierw strona −y (ku wyłomowi), zawias po stronie +y trzyma, a przy uderzeniu głowy pada, razem z szybem.
  const wz = cz.get('H-C + H-T');
  const zCore = wz.zSzyb[1], zN = zCore + 2 * dx;
  const [tS0, tS1] = T.szyb;
  const rN = Hs.neckR;
  const ciecia = [
    [tS0, 0, -0.9 * rN, zN + 130, 1.05 * rN, 1],
    [tS0 + 0.3, 0, -0.9 * rN, zN + 330, 1.05 * rN, 1],
    [tS1, 0, 0.9 * rN, zN + 130, 1.3 * rN, 1],
    [tS1, 0, -0.8 * Hs.coreR, zCore - 150, 1.0 * Hs.coreR, 0.8],
    [tS1 + 0.2, 0, 0.8 * Hs.coreR, zCore - 150, 1.0 * Hs.coreR, 0.8],
  ];
  for (const [t, x, y, z, r, rdz] of ciecia) kr.push(krater({ f: F(t), nos: nosiciel(sc, wz, x, y, z), r, rdzen: rdz, J: 60, rP: 1.3 * r, rodz: 'glowna' }));

  // Dysk puszcza sektorami: od tych przy uderzeniu głowy (−y), na boki. Kula na łuku kotwicy, kula główna i dwie małe na szwie ku następnemu sektorowi.
  const dys = cz.get('dysk D-1…8');
  const d = dys.dysk;
  const ileSek = Hs.discSectors, kk = TAU / ileSek;
  const zSr = 0.5 * (d.zDol + k7HeightToZ(Hs.discY1));
  // Kolejność od sektora, w którym leży −y (kąt bazy +π/2, H-S), na obie strony.
  const kol = [];
  const sP = Math.round((Math.PI / 2) / kk);
  kol.push(sP);
  for (let e = 1; kol.length < ileSek; e++) { kol.push((sP + e) % ileSek); if (kol.length < ileSek) kol.push((sP - e + ileSek) % ileSek); }
  const [tD0, tD1] = T.sektory;
  for (let e = 0; e < ileSek; e++) {
    const s = kol[e], a = s * kk;
    const t = tD0 + ((tD1 - tD0) * e) / ileSek;
    const rK = d.R0 + 30;
    const xK = rK * Math.cos(a), yK = -rK * Math.sin(a);
    kr.push(krater({ f: F(t), nos: nosiciel(sc, dys, xK, yK, zSr), r: Math.max(0.5 * o.wspornikDl + 60, 2 * dx + 40), rdzen: 0.5, rS: 0, J: o.J, rP: 420, tau: o.tau, dz: -60, rodz: 'wspornik' }));
    const aS = a + 0.5 * kk;
    for (const [fr, rodz, rr, JJ] of [[0.55, 'glowna', 1.2, o.J], [0.32, 'mala', 1, o.Jmala], [0.8, 'mala', 1, o.Jmala]]) {
      const Rg = d.R0 + fr * (d.R - d.R0);
      kr.push(krater({ f: F(t + 0.25 + 0.5 * los()), nos: nosiciel(sc, dys, Rg * Math.cos(aS), -Rg * Math.sin(aS), zSr), r: rr * Math.max(90, 2.2 * dx), rdzen: 0.2, rS: 0, J: JJ, rP: rodz === 'glowna' ? 640 : 340, tau: o.tauSzew, dz: (los() < 0.7 ? -1 : 1) * 120 * (0.4 + 0.6 * los()), rodz }));
    }
  }

  // Ogień w rurach: zbiorniki, magazyn, potem front wzdłuż pomostów (FUEL_CHAIN_TUNE ma 1100 j./s, w próbie szybciej, żeby kadr miał wszystko naraz).
  const [tF0, vF] = [T.paliwo[0], (T.paliwo[1] - T.paliwo[0])];
  const P = l.nodes.P;
  const dlMax = Math.sqrt(Math.max(...sc.meta.budynki.map((_, q) => {
    const p = sc.pos; const i = sc.meta.budynki[q].start;
    return (p[3 * i] - P.x) ** 2 + (p[3 * i + 1] + P.z) ** 2;
  })));
  const czasF = (x, y) => tF0 + (vF * Math.sqrt((x - P.x) ** 2 + (y + P.z) ** 2)) / dlMax;
  for (const t of l.tanks) {
    const c = cz.get(t.id), zb = c.zbiornik;
    const tT = czasF(zb.x, zb.y) + 0.3 * los();
    for (const [dz, fr] of [[0.25, 'wieza'], [0.7, 'glowna']]) kr.push(krater({ f: F(tT + 0.2 * dz), nos: nosiciel(sc, c, zb.x, zb.y, zb.z0 + dz * (zb.z1 - zb.z0)), r: zb.r + 60, rdzen: 0.5, J: 180, rP: 600, rodz: fr }));
  }
  for (const nazwa of ['P-M', 'M-1']) {
    const c = cz.get(nazwa), m = c.skrzynia;
    kr.push(krater({ f: F(czasF(m.x, m.y)), nos: nosiciel(sc, c, m.x, m.y, m.z1), r: 2.5 * rMin, J: 150, rP: 500, rodz: 'glowna' }));
    if (nazwa === 'M-1') for (const u of [-1, 1]) kr.push(krater({ f: F(czasF(m.x, m.y) + 0.3 + 0.2 * los()), nos: nosiciel(sc, c, m.x + u * 500, m.y, 0.5 * (m.z0 + m.z1)), r: 2.2 * rMin, J: 150, rP: 420, rodz: 'mala' }));
  }
  for (const p of l.piers) {
    const c = cz.get(p.id);
    const krok = o.pomostCo;
    for (let s = 0.5 * krok; s < p.len; s += krok) {
      const x = p.ax + p.ux * s, y = -(p.az + p.uz * s), z = 0.5 * (k7HeightToZ(l.spec.pier.deckY0) + k7HeightToZ(l.spec.pier.deckY1));
      kr.push(krater({ f: F(czasF(x, y) + 0.15 * los()), nos: nosiciel(sc, c, x, y, z), r: 1.6 * rMin, rdzen: 0.5, J: 110, rP: 260, rodz: 'mala' }));
    }
  }
  kr.sort((a, b) => a.f - b.f);
  return { kratery: kr, puscKotwiceF: F(T.puszcza) };
}

const OPCJE_B1 = Object.freeze({
  ...S5_OPCJE,
  podSektor: [3, 5], warpA: 170, warpS1: 700,
  krokZeber: 20, krokObwodowy: 300, wspornikDl: 340,
  pasTor: 640, dlTor: 1500, torF: 0.7, szerWieniec: 90,
  pomostCo: 620, Jmala: 90,
  ziarno: 21,
  // Plan chwil: w grze misja idzie wolniej, a tu kadr ma się czytać (plan § 5c).
  // szyb: nacięcie od strony wyłomu w pierwszej liczbie, a zawias przecięty w drugiej, kiedy głowa uderza.
  czasy: Object.freeze({ w1: [1, 4], w2: [4, 7], wylom: [7, 10], szyb: [10, 14], sektory: [15, 20], paliwo: [17, 21.5], puszcza: 21.5 }),
  mocSzyi: 8,
  // Mnożnik granicy gięcia szyi i szybu (rdzeń w promieniu pierścienia). Domyślnie jak siła (8): szyja nie pęka od zginania nigdy i gnie się jak guma
  // (zgłoszenie użytkownika 2026-11-08). Demo B1R ma 1: siła zostaje, zgięta szyja pęka. Gra (wGrze) bez zmian, dopóki użytkownik nie zdecyduje.
  giecieSzyi: 8,
  // Od 2026-11-11 habitat to miasto wieżowców wokół wieży (prośba użytkownika), dawnego bębna nie ma. bezMiasta: sama wieża na dysku. szyjaR: promień trzonu wieży zamiast neckR z układu (0: z układu).
  // Trzon pod wieżą ma zawsze pokrywę i dno: bez nich podstawa wieży stała nad pustą rurą i wisiała w powietrzu (zgłoszenie użytkownika 2026-11-09).
  bezMiasta: false, // true: bez wieżowców miasta (sama wieża na dysku, jak dawne demo „bez bębna”)
  szyjaR: 0,
  szyjaWnetrze: 1, // 0 pusta rura, 1 stropy jak w wieżowcu (gra od 2026-11-11: duża wieża), 2 pełna (budujWieze)
  mocPodestu: 30,
  T: 30,
});

/**
 * Scena B1. o: { dx (40 albo 80), ziarno, T, czasy, stoi (true: bez zdarzeń, W1) }.
 * Wynik: plan dla zbudujPlan z budowa.js (scena, nakladka, gpu, dane szwów), a w plan.miasto.budynki części z tonem barwy i nazwą (obraz, statBazy), w plan.czesci tabela węzłów.
 */
export function scenaB1(oo = {}) {
  const o = { ...OPCJE_B1, ...oo, czasy: { ...OPCJE_B1.czasy, ...oo.czasy } };
  const dx = o.dx ?? DX_BAZY;
  // W grze (wGrze.js): bez planu krater po kraterze (kratery zleca misja) i z gruntem na poziomie skały pod bazą.
  if (o.wGrze) o.stoi = true;
  // Skrypt zniszczeń (planSekwencji) robi wyłom w ćwiartce miasta: baza bez miasta ma tylko tryb bez skryptu.
  if (o.bezMiasta) o.stoi = true;
  const l0 = createPirateBaseLayout({ id: 'B1' });
  const l = o.szyjaR > 0 ? { ...l0, habitat: { ...l0.habitat, neckR: o.szyjaR } } : l0;
  const Hs = l.habitat;
  const b = createBudowa(dx);
  const los = prng((o.ziarno >>> 0) * 6151 + 29);
  budujReaktory(b, l);
  const podesty = b.czesci.map((c) => c.podest);
  budujWieze(b, Hs, o.szyjaWnetrze);
  if (!o.bezMiasta) budujMiasto(b, l);
  budujTrzon(b, Hs, true);
  budujPomosty(b, l, podesty);
  budujPaliwo(b, l);
  budujMagazyn(b, l);
  const czDysk = budujDysk(b, Hs, o);
  const sc = zloz(b, czDysk, l);
  if (Number.isFinite(o.gruntZ)) sc.gruntZ = o.gruntZ;
  const cz = new Map(b.czesci.map((c) => [c.nazwa, c]));
  const nD = czDysk.n, nW = czDysk.start;
  const { seg, nSeg, pod, nPod, wewnSek } = sektoryDysku(sc, nW, nD, o, Hs.discSectors, los);
  const kotwiceWsp = [];
  for (let i = nW; i < nW + nD; i++) if (sc.kind[i] === KIND.KOTWICA) kotwiceWsp.push(i);
  // Tor wieży przez dysk ku −y: tam leci głowa, wnętrze sekcji bez wzmocnienia (wypieczSzwy).
  const dane = { nW, nD, seg, nSeg, pod, nPod, wewnSek, kotwiceWsp, o: { ...o, nSekcji: nSeg, R: czDysk.dysk.R }, u: [0, -1, 0], wOs: [1, 0, 0], pX: 0, pY: -500, prozn: false };
  const pl = o.stoi ? { kratery: [], puscKotwiceF: -1 } : planSekwencji(sc, cz, l, o, los);
  const czesci = b.czesci.map((c) => ({ nazwa: c.nazwa, n: c.n }));
  // Liny i spoiny (planLin, LINY_B1): przy upadku środek ciągnie boki, a części boków się nie rozjeżdżają. o.liny false: bez nich (A/B).
  const liny = o.liny === false ? [] : planLin(sc, b.czesci, Hs, dx);
  const wz = cz.get('H-C + H-T');
  let wSzyb = 0;
  for (let q = 0; q < wz.K.length; q++) if ((wz.K[q] + 0.5) * dx <= wz.zSzyb[1]) wSzyb++;
  const w1 = o.bezMiasta ? cz.get(l.antigravs[0].id).reaktor : cz.get(l.habitat.buildings[0].id).wiezowiec;
  // AGENT: szyja to drąg: wytrzymałość liczona z ciężaru głowy kruszy ją po nacięciu i głowa spada pionowo (pierwszy bieg). W grze zawias jest jawny (engine.addJoint, pirateBaseNeck.js), a tu szyja i szyb dostają zapas, a krater dalej usuwa węzły, więc nacięcie i przecięcie działają. Głowa zostaje zwykła i rozbija się przy uderzeniu.
  const mocS = o.mocSzyi, nzH = wz.start + wz.n, rP2 = Hs.ringR0 * Hs.ringR0;
  // Rdzeń szyi jako wnętrze ziarna (klasa + 6: fala go nie łamie, gięcie do zlomWewn) tylko przy wzmocnionej szyi. Szyja bez wzmocnienia (demo B1R) pęka
  // po granicach ziaren jak reszta betonu (druga opinia 2026-11-08). Gra: mocSzyi 8, więc bez zmian.
  const wnetrzeSzyi = o.wnetrzeSzyi ?? mocS > 1;
  // Bez zapasu zostaje tylko zewnętrzny pierścień talerza: on rozbija się przy uderzeniu.
  const mocny = (w, i) => w.pos[3 * i] ** 2 + w.pos[3 * i + 1] ** 2 < rP2;
  const poWypieku = (w) => {
    // Zaczep liny (koniec b): wiązania węzła × mocZaczepu i klasa wnętrza ziarna, żeby pierwsze szarpnięcie nie wyrwało go z części. Każde wiązanie raz.
    const zrobione = new Set();
    for (const li of liny) for (let d = 0; d < ND; d++) {
      const ox = STRONA * li.b + d, j = w.nbr[ox];
      if (j < 0) continue;
      const oy = STRONA * j + (d ^ 1);
      if (zrobione.has(Math.min(ox, oy))) continue;
      zrobione.add(Math.min(ox, oy));
      w.Ft[ox] *= LINY_B1.mocZaczepu; w.Ft[oy] = w.Ft[ox];
      w.Fc[ox] *= LINY_B1.mocZaczepu; w.Fc[oy] = w.Fc[ox];
      if (w.klasaW[ox] < 6) w.klasaW[ox] = w.klasaW[oy] = w.klasaW[ox] + 6;
    }
    // Podest wieżowca: pomost liczy się tylko na własny ciężar, a ma przyjąć gruz. Bez tego góra przebija go i spada na planetoidę zamiast składać się na pomost.
    for (const c of [...new Set(podesty.map((d) => d.pomost))].map((id) => cz.get(id))) for (let i = c.start; i < c.start + c.n; i++) {
      const naPodescie = (q) => podesty.some((d) => Math.abs(w.pos[3 * q] - d.x) <= d.pw && Math.abs(w.pos[3 * q + 1] - d.y) <= d.pd);
      if (!naPodescie(i)) continue;
      for (let d = 0; d < ND; d++) {
        const ox = STRONA * i + d, j = w.nbr[ox];
        if (j <= i) continue;
        const oy = STRONA * j + (d ^ 1);
        w.Ft[ox] *= o.mocPodestu; w.Ft[oy] = w.Ft[ox];
        w.Fc[ox] *= o.mocPodestu; w.Fc[oy] = w.Fc[ox];
        if (w.klasaW[ox] < 6) w.klasaW[ox] = w.klasaW[oy] = w.klasaW[ox] + 6;
      }
    }
    for (let i = wz.start; i < nzH; i++) {
      if (!mocny(w, i)) continue;
      w.bMax2W[i] *= o.giecieSzyi * o.giecieSzyi;
      for (let d = 0; d < ND; d++) {
        const ox = STRONA * i + d, j = w.nbr[ox];
        if (j <= i || !mocny(w, j)) continue;
        const oy = STRONA * j + (d ^ 1);
        w.Ft[ox] *= mocS; w.Ft[oy] = w.Ft[ox];
        w.Fc[ox] *= mocS; w.Fc[oy] = w.Fc[ox];
        if (wnetrzeSzyi && w.klasaW[ox] < 6) w.klasaW[ox] = w.klasaW[oy] = w.klasaW[ox] + 6;
      }
    }
  };
  return {
    poWypieku,
    id: 'B1',
    liny,
    opis: `Baza piratów, dx = ${dx}, ${sc.n} węzłów, ${b.czesci.length} części, ${pl.kratery.length} kraterów`,
    scena: sc,
    g: G,
    T: o.T,
    zdarzeniaOd: pl.kratery.length ? pl.kratery[0].f / 60 : Infinity,
    zdarzenia: () => 0, // tylko GPU
    nakladka: { ...S5_NAKLADKA, ziarno: o.ziarno },
    dane,
    gpu: { zerujL: false, kratery: pl.kratery, puscKotwiceF: pl.puscKotwiceF },
    czesci,
    // Promienie kół habitatu jak ustawKola w wGrze.js: obraz kawałków dociąga do nich narożniki części z bitem koła (kawalki.js, opcje.kola).
    kola: kolaHabitatu(Hs),
    wezlySzybu: wSzyb,
    // Pola jak plan miasta: pokaz.js bierze stąd tony części, kamerę z bliska i statBazy.
    miasto: {
      baza: true,
      budynki: b.czesci.map((c) => ({ start: c.start, n: c.n, ton: c.ton, nazwa: c.nazwa })),
      trafione: new Uint8Array(b.czesci.length),
      celBliska: [w1.x, w1.y, 0.5 * (w1.zB + w1.zD)],
      trafien: pl.kratery.length,
      budynkow: b.czesci.length,
      // Skóra w demie (dema/woksele-zawalenia/skoraDema.js): wypiek starej bryły bez ćwiartek miasta, gdy woksele nie mają wieżowców; koła habitatu dla obrazu brył.
      bezMiasta: !!o.bezMiasta,
      kola: kolaHabitatu(Hs),
    },
    czasy: { indeksy: new Int32Array(0), t: new Float64Array(0), rozerwij: new Uint8Array(0), zostawZiarna: false },
  };
}
