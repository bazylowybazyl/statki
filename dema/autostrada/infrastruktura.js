// dema/autostrada/infrastruktura.js
//
// Rozmieszczenie infrastruktury na sieci (czyste dane, bez three): bary stopu z fizycznych lamp, głowice sygnałów, bramownice, wieże
// węzłów, boje, kocie oczy, tory przy K-7. Współrzędne sceny (y w górę), lokalnie względem środka Ziemi.
import { HW, NODE, DEG, complexes, transits, bays, hubToWorld } from './siec.js';

const polar = (r, aDeg) => ({ x: r * Math.cos(aDeg * DEG), y: r * Math.sin(aDeg * DEG) });

/** Tryby lamp (kod w shaderze baza3d). */
export const TRYB_LAMPY = Object.freeze({ STALA: 0, BAR_STOPU: 1, GLOWICA: 2, KROLIK: 3, TOR_K7: 4, WIEZA: 5, UPRZEDZENIE: 6 });

const KRAWEDZIE = Object.freeze([
  Object.freeze({ cw: 0, zew: HW.edgeIn, wew: HW.iL1 + HW.widths.L1 * 0.5 }),
  Object.freeze({ cw: 1, zew: HW.edgeOut, wew: HW.oL1 - HW.widths.L1 * 0.5 })
]);

/** Kąt na jezdni `cw` o d j. „pod prąd” od kąta a (po stronie napływu). */
const napływ = (cw, a, d, r) => (cw === 0 ? a + d / r / DEG : a - d / r / DEG);

export function zbudujInfrastrukture() {
  const lampy = [];      // { x, y, rozm, grupa, r, g, b, tryb, faza }
  const lampyFG = [];    // głowice nad bramownicami (pass FG)
  const bramownice = []; // { x, y, kat, dl, stop: k7 | -1 }
  const wieze = [];      // { x, y, kat, rozm }
  const boje = [];       // { x, y, kat }
  const dodaj = (lista, p, rozm, grupa, c, tryb, faza = 0) => lista.push({ x: p.x, y: p.y, rozm, grupa, r: c[0], g: c[1], b: c[2], tryb, faza });

  const STOP = [6, 0.07, 0.02];
  const OKO = [0.34, 0.42, 0.5];
  const BURSZTYN = [1.4, 0.62, 0.05];
  const BLEKIT = [0.3, 0.75, 2.2];
  const BIEL = [1.0, 0.96, 0.85];

  complexes().forEach((c, k) => {
    for (const j of KRAWEDZIE) {
      const rSr = (j.zew + j.wew) * 0.5;
      const kat = napływ(j.cw, c, NODE.stopX, rSr);
      // Bar stopu: rząd lamp w poprzek jezdni (z daleka zleje się w linię, z bliska jest przedmiotem).
      const r0 = Math.min(j.zew, j.wew);
      const r1 = Math.max(j.zew, j.wew);
      for (let r = r0 + 40; r <= r1 - 40; r += 44) dodaj(lampy, polar(r, kat), 9, k, STOP, TRYB_LAMPY.BAR_STOPU, 0);
      // Bramownica na linii stopu + głowice nad pasami.
      bramownice.push({ ...polar(rSr, napływ(j.cw, c, NODE.stopX + 70, rSr)), kat: napływ(j.cw, c, NODE.stopX + 70, rSr), dl: r1 - r0 + 120, stop: k });
      for (const [rp, sz] of [[j.cw === 0 ? HW.iL3 : HW.oL3, 34], [j.cw === 0 ? HW.iL2 : HW.oL2, 40], [j.cw === 0 ? HW.iL1 : HW.oL1, 40]]) {
        dodaj(lampyFG, polar(rp, napływ(j.cw, c, NODE.stopX + 70, rSr)), sz * 0.55, k, STOP, TRYB_LAMPY.GLOWICA, 0);
      }
      // Bramownice uprzedzenia na 8 i 16 tys. j. przed węzłem + ostrzegacze.
      for (const d of [8000, 16000]) {
        const a = napływ(j.cw, c, d, rSr);
        bramownice.push({ ...polar(rSr, a), kat: a, dl: r1 - r0 + 120, stop: -1 });
        for (const rp of [j.zew, j.wew]) dodaj(lampyFG, polar(rp, a), 18, k, BURSZTYN, TRYB_LAMPY.UPRZEDZENIE, d / 8000);
      }
      // Boje sygnalne: bursztyn biegnący ku barowi, na obu brzegach jezdni, od 2,4 do 12 tys. j. przed linią.
      for (let i = 0; i < 8; i++) {
        const d = NODE.stopX + 1200 + i * 1200;
        const a = napływ(j.cw, c, d, rSr);
        for (const rp of [j.zew, j.wew]) {
          const p = polar(rp, a);
          boje.push({ ...p, kat: a });
          dodaj(lampy, p, 11, k, BURSZTYN, TRYB_LAMPY.KROLIK, i / 8);
        }
      }
    }
    // Wieża węzła K-7 w pasie rozdziału (czerwona lampa: jedyny mocny bloom drogi).
    const pW = polar(HW.median, c);
    wieze.push({ ...pW, kat: c, rozm: 420 });
    dodaj(lampy, pW, 36, k, STOP, TRYB_LAMPY.WIEZA, 0);
    // Tory przy K-7: od płyty przed bramą do r ≈ 68 tys., po bokach każdego pasa promieniowego.
    for (const x of NODE.boxLanes) {
      const wylot = x === -810 || x === 810;
      for (let z = 8700; z <= 22000; z += 420) {
        for (const bok of [-1, 1]) {
          const p = hubToWorld(c, x + bok * 640, z);
          dodaj(lampy, p, 8, k, wylot ? [0.15, 1.5, 0.55] : BLEKIT, TRYB_LAMPY.TOR_K7, (wylot ? z : -z) / 420 / 14);
        }
      }
    }
  });

  // Kocie oczy na brzegach pasa rozdziału i na krawędziach jezdni.
  const krok = 6000 / HW.median / DEG;
  for (let a = 0; a < 360; a += krok) {
    for (const r of [KRAWEDZIE[0].wew, KRAWEDZIE[1].wew]) dodaj(lampy, polar(r, a), 7, 0, OKO, TRYB_LAMPY.STALA, 0);
  }
  const krok2 = 3000 / HW.edgeOut / DEG;
  for (let a = 0; a < 360; a += krok2) {
    for (const r of [HW.edgeIn, HW.edgeOut]) dodaj(lampy, polar(r, a), 5, 0, [0.2, 0.24, 0.28], TRYB_LAMPY.STALA, 0);
  }

  // Bramownice stałe co ok. 13 tys. j. (omijają pudła K-7 i bramownice uprzedzenia).
  const zajete = (a) => complexes().some((c) => {
    let d = Math.abs(((a - c + 540) % 360) - 180);
    d *= DEG * HW.median;
    return d < 18500;
  });
  const n = Math.round((2 * Math.PI * HW.median) / 13000);
  for (let i = 0; i < n; i++) {
    const a = i * 360 / n + 2;
    if (zajete(a)) continue;
    for (const j of KRAWEDZIE) {
      const rSr = (j.zew + j.wew) * 0.5;
      bramownice.push({ ...polar(rSr, a), kat: a, dl: Math.abs(j.zew - j.wew) + 120, stop: -1 });
    }
  }

  // Wieże pozostałych węzłów: zatoki i tranzyty (przy krawędzi wewnętrznej), boje na dziobach ramp.
  for (const a of [...bays(), ...transits()]) {
    const p = polar(HW.edgeIn - 620, a);
    wieze.push({ ...p, kat: a, rozm: 300 });
    dodaj(lampy, p, 20, 0, BIEL, TRYB_LAMPY.STALA, 0);
    for (const bok of [-1, 1]) {
      const g = polar(HW.edgeIn - 180, a + bok * 3.2);
      boje.push({ ...g, kat: a });
      dodaj(lampy, g, 14, 0, BURSZTYN, TRYB_LAMPY.STALA, 0);
    }
  }
  return { lampy, lampyFG, bramownice, wieze, boje };
}
