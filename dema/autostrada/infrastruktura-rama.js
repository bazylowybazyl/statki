// dema/autostrada/infrastruktura-rama.js
//
// Rozmieszczenie infrastruktury na sieci „Rama” (czyste dane, bez three) — ten sam kształt wyniku co `zbudujInfrastrukture()`
// pierścienia, więc rysuje je ta sama baza obrazu. Miejsca liczone przez `siec.geo` (droga wzdłuż pasa, współrzędna boczna):
// bar stopu i bramownica stoją dokładnie na linii stopu ruchu, także na łuku naroża. Dodatkowo lampy robocze makiety stoczni.
import { HW, NODE, complexes, hubToWorld, R0 } from './siec.js';
import { RAMA } from './siec-rama.js';
import { TRYB_LAMPY } from './infrastruktura.js';

const RAD = 180 / Math.PI;

const KRAWEDZIE = Object.freeze([
  Object.freeze({ cw: 0, zew: HW.edgeIn, wew: HW.iL1 + HW.widths.L1 * 0.5 }),
  Object.freeze({ cw: 1, zew: HW.edgeOut, wew: HW.oL1 - HW.widths.L1 * 0.5 })
]);

export function zbudujInfrastruktureRamy(siec) {
  const geo = siec.geo;
  const u = siec.rama;
  const lampy = [];
  const lampyFG = [];
  const bramownice = [];
  const wieze = [];
  const boje = [];
  const _p = { x: 0, y: 0, h: 0, kr: 0 };
  /** Punkt pasa: droga s na jezdni cw, współrzędna boczna r; `kat` — kierunek w poprzek drogi na zewnątrz [stopnie]. */
  const pkt = (cw, s, r) => {
    geo.poza(cw, s, r, _p);
    return { x: _p.x, y: _p.y, kat: (cw === 1 ? _p.h - Math.PI * 0.5 : _p.h + Math.PI * 0.5) * RAD };
  };
  const dodaj = (lista, p, rozm, grupa, c, tryb, faza = 0) => lista.push({ x: p.x, y: p.y, rozm, grupa, r: c[0], g: c[1], b: c[2], tryb, faza });

  const STOP = [6, 0.07, 0.02];
  const OKO = [0.34, 0.42, 0.5];
  const BURSZTYN = [1.4, 0.62, 0.05];
  const BLEKIT = [0.3, 0.75, 2.2];
  const BIEL = [1.0, 0.96, 0.85];
  const SOD = [1.15, 0.62, 0.2];
  const stopX = siec.wezel.stopX;

  complexes().forEach((c, k) => {
    for (const j of KRAWEDZIE) {
      const rSr = (j.zew + j.wew) * 0.5;
      const r0 = Math.min(j.zew, j.wew);
      const r1 = Math.max(j.zew, j.wew);
      const sStop = geo.sWzdluz(j.cw, c, -stopX);
      for (let r = r0 + 40; r <= r1 - 40; r += 44) dodaj(lampy, pkt(j.cw, sStop, r), 9, k, STOP, TRYB_LAMPY.BAR_STOPU, 0);
      const sBram = geo.sWzdluz(j.cw, c, -(stopX + 70));
      bramownice.push({ ...pkt(j.cw, sBram, rSr), dl: r1 - r0 + 120, stop: k });
      for (const [rp, sz] of [[j.cw === 0 ? HW.iL3 : HW.oL3, 34], [j.cw === 0 ? HW.iL2 : HW.oL2, 40], [j.cw === 0 ? HW.iL1 : HW.oL1, 40]]) {
        dodaj(lampyFG, pkt(j.cw, sBram, rp), sz * 0.55, k, STOP, TRYB_LAMPY.GLOWICA, 0);
      }
      // Bramownice uprzedzenia 8 i 16 tys. j. przed osią węzła (druga stoi już na prostej przed narożem).
      for (const d of [8000, 16000]) {
        const s = geo.sWzdluz(j.cw, c, -d);
        bramownice.push({ ...pkt(j.cw, s, rSr), dl: r1 - r0 + 120, stop: -1 });
        for (const rp of [j.zew, j.wew]) dodaj(lampyFG, pkt(j.cw, s, rp), 18, k, BURSZTYN, TRYB_LAMPY.UPRZEDZENIE, d / 8000);
      }
      for (let i = 0; i < 8; i++) {
        const s = geo.sWzdluz(j.cw, c, -(stopX + 1200 + i * 1200));
        for (const rp of [j.zew, j.wew]) {
          const p = pkt(j.cw, s, rp);
          boje.push(p);
          dodaj(lampy, p, 11, k, BURSZTYN, TRYB_LAMPY.KROLIK, i / 8);
        }
      }
    }
    // Wieża węzła w pasie rozdziału na wierzchołku naroża.
    const pW = pkt(1, geo.sKata(1, c), HW.median);
    wieze.push({ ...pW, rozm: 420 });
    dodaj(lampy, pW, 36, k, STOP, TRYB_LAMPY.WIEZA, 0);
    // Tory pasów stoczni: od głowicy (pochylnie) albo od burty przed głowicą (pasy ciężkich) przez naroże w kosmos.
    const zKoniec = siec.atlas.zZwolnienia + 5000;
    for (const x of RAMA.pasy) {
      const wylot = RAMA.pasWylot.includes(x);
      const pochylnia = Math.abs(x) === 810;
      const zOd = pochylnia ? u.zasieg + 300 : u.zasieg - 5200;
      const krok = pochylnia ? 420 : 840;       // pasy ciężkich rzadziej i drobniej — główny tor to pochylnie
      for (let z = zOd; z <= zKoniec; z += krok) {
        for (const bok of [-1, 1]) {
          dodaj(lampy, hubToWorld(c, x + bok * 640, z), pochylnia ? 8 : 6, k, wylot ? [0.15, 1.5, 0.55] : BLEKIT, TRYB_LAMPY.TOR_K7, (wylot ? z : -z) / 420 / 14);
        }
      }
    }
    // Makieta stoczni: lampy robocze wzdłuż burt i grzbietu (nad statkami), czerwone lampy przeszkodowe na głowicy.
    for (let z = RAMA.zBramyK7 + 500; z <= u.zasieg - 200; z += 720) {
      for (const x of [-RAMA.stoczniaPol, RAMA.stoczniaPol]) dodaj(lampyFG, hubToWorld(c, x, z), 13, k, SOD, TRYB_LAMPY.STALA, 0);
      if (((z - RAMA.zBramyK7) / 720) % 3 < 1) dodaj(lampyFG, hubToWorld(c, 0, z), 9, k, BIEL, TRYB_LAMPY.STALA, 0);
    }
    for (const x of [-RAMA.stoczniaPol - 120, 0, RAMA.stoczniaPol + 120]) dodaj(lampyFG, hubToWorld(c, x, u.zasieg + 60), 20, k, [2.2, 0.06, 0.03], TRYB_LAMPY.STALA, 0);
  });

  // Kocie oczy: brzegi pasa rozdziału co 6 tys. j., krawędzie jezdni co 3 tys. j.
  const ob = geo.OBWOD[1];
  for (let s = 0; s < ob; s += 6000) {
    for (const r of [KRAWEDZIE[0].wew, KRAWEDZIE[1].wew]) dodaj(lampy, pkt(1, s, r), 7, 0, OKO, TRYB_LAMPY.STALA, 0);
  }
  for (let s = 0; s < ob; s += 3000) {
    for (const r of [HW.edgeIn, HW.edgeOut]) dodaj(lampy, pkt(1, s, r), 5, 0, [0.2, 0.24, 0.28], TRYB_LAMPY.STALA, 0);
  }

  // Bramownice stałe co ok. 13 tys. j. — poza strefą węzłów stoczni (tam stoją bramownice sygnału i uprzedzenia).
  const osie = complexes().map((c) => geo.sKata(1, c));
  const n = Math.round(ob / 13000);
  for (let i = 0; i < n; i++) {
    const s = (i + 0.15) * ob / n;
    if (osie.some((so) => { const d = Math.abs(s - so); return Math.min(d, ob - d) < 18500; })) continue;
    const os = pkt(1, s, HW.median);
    for (const j of KRAWEDZIE) {
      const rSr = (j.zew + j.wew) * 0.5;
      bramownice.push({ ...pkt(j.cw, geo.sPunktu(j.cw, os.x, os.y), rSr), dl: Math.abs(j.zew - j.wew) + 120, stop: -1 });
    }
  }

  // Wieże zatok i tranzytów przy krawędzi wewnętrznej, między zjazdem a wjazdem; boje na dziobach ramp.
  const Z = (r) => r + u.dz - R0;
  for (const w of siec.nodes) {
    if (w.kind !== 'bay' && w.kind !== 'transit') continue;
    const p = hubToWorld(w.bok, (w.xIn + w.xOut) * 0.5, Z(HW.edgeIn - 620));
    wieze.push({ ...p, kat: w.bok, rozm: 300 });
    dodaj(lampy, p, 20, 0, BIEL, TRYB_LAMPY.STALA, 0);
    for (const x of [w.xIn + NODE.decelLen, w.xOut - NODE.accelLen]) {
      const g = hubToWorld(w.bok, x, Z(HW.edgeIn - 180));
      boje.push({ ...g, kat: w.bok });
      dodaj(lampy, g, 14, 0, BURSZTYN, TRYB_LAMPY.STALA, 0);
    }
  }
  return { lampy, lampyFG, bramownice, wieze, boje };
}
