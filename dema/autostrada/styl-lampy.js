// dema/autostrada/styl-lampy.js
//
// STYL „NOCNE PODEJŚCIE” — droga z samych lamp, jak nocne lotnisko z okna samolotu: zgaś lampy, a drogi nie ma. Paleta spoczynkowa to
// trzy barwy (ciepła biel krawędzi, bursztyn mediany, chłodne kocie oczy); zieleń, czerwień i biel królika są tylko w sekwencji i na torach.
// Powody istnienia wariantu:
//  - KURTYNA: ok. 240 fizycznych lamp z korytarza K-7 zjeżdża z kursu okrętu i staje w poprzek pasów: czerwony bar z trzech rzędów po stronie napływu,
//    bursztynowy rząd po stronie odpływu i białe brzegi pasa wokół osi przejazdu,
//  - ŚCIEŻKA ZIELENI: lampy osi toru palą się tylko przed dziobem Atlasa, sylwetkę gasi sam kadłub (rysuje się nad lampami),
//  - frachtowiec jako ruchoma dziura w sznurze świateł (kadłuby proxy leżą nad lampami).
// Geometria: JEDNA partia kwadów (Mesh + InstancedBufferGeometry, dane stałe, zero wysyłek w spoczynku) i jedna wstęga poświaty.
//
// AGENT: stan sekwencji jest czystą funkcją (faza, czas fazy) K-7 i pozy Atlasa — liczony od nowa co klatkę, bez pamięci w stylu, więc
// przełączenie stylu w środku sekwencji nic nie psuje. Reguła progu bloomu: patrz tabela KLASY (`podProgiem`).
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, uniform, uniformArray, float, vec2, vec3, vec4, max, min, abs, mix, exp, clamp, smoothstep, step, fract, length, dot,
  normalize, sin, positionGeometry, varyingProperty, varying, modelViewMatrix, cameraViewMatrix, positionLocal, fwidth, texture, atan, PI2
} from 'three/tsl';
import { U, materialAddytywny, BARWY, kolor, zaKula } from './wspolne.tsl.js';
import { HW, NODE, DEG, complexes, hubToWorld, punktNaSciezce, R0 } from './siec.js';
import { FAZA } from './ruch.js';
import { resolveRingPlanetWorldRadius } from '../../src/3d/ringScale.js';

const TAU = Math.PI * 2;

// Barwy znormalizowane do luminancji 1 (Rec. 709), żeby amplituda A w tabeli była wprost szczytem luminancji — próg bloomu liczy luminancję.
const BIEL = Object.freeze([1.25, 0.96, 0.63]);
const BURSZTYN = Object.freeze([2.03, 0.79, 0.026]);
const CHLOD = Object.freeze([0.85, 1.01, 1.36]);
const ZIELEN = Object.freeze([0.01, 1.36, 0.39]);
const KROLIK = Object.freeze([0.98, 1.0, 1.08]);
const LATARNIA = Object.freeze([1.47, 0.93, 0.37]);

// Klasy lamp. s0 — sigma właściwa wzdłuż / w poprzek [j.], minPx / maxPx — sigma rdzenia w px (sygnał nie rośnie przy zbliżeniu ponad ~3 px),
// A — szczyt luminancji [z daleka fw ≥ 30, średnio fw ≈ 7, z bliska fw ≤ 2 j./px], aH / rH — halo (zawsze pod progiem),
// fwWidoczne — klasa gaśnie powyżej tego śladu, fala — fala kierunku, drogowa — lampa jezdni (fala bursztynu, zwolnienie),
// rB — promień korpusu [j.], plask — z bliska płaski szczyt (szklana kapsułka), podProgiem — przy śladzie ≥ ~4 j./px szczyt ≤ 0,8 (bloom 0).
const K = Object.freeze({ L1: 0, L2: 1, OS: 2, L0: 3, STRZALKA: 4, RAMPA: 5, TOR: 6, KROLIK: 7, MARKER: 8, SCIEZKA: 9 });
const KLASY = Object.freeze([
  { s0: [7, 7], minPx: 0.95, maxPx: 3, A: [0.40, 0.60, 2.2], aH: 0.055, rH: 46, fwWidoczne: 1e6, fala: 1, drogowa: 1, rB: 18, plask: 0, podProgiem: 1 },
  { s0: [9, 3.6], minPx: 0.9, maxPx: 1e3, A: [0.20, 0.42, 0.8], aH: 0.03, rH: 16, fwWidoczne: 1e6, fala: 0, drogowa: 1, rB: 0, plask: 1, podProgiem: 1 },
  { s0: [5, 3], minPx: 0.9, maxPx: 1e3, A: [0, 0, 0.42], aH: 0.025, rH: 14, fwWidoczne: 3.6, fala: 0, drogowa: 1, rB: 0, plask: 1, podProgiem: 1 },
  { s0: [16, 16], minPx: 1.8, maxPx: 3.4, A: [4.4, 4.6, 5], aH: 0.12, rH: 150, fwWidoczne: 1e6, fala: 0, drogowa: 0, rB: 44, plask: 0, podProgiem: 0 },
  { s0: [6, 6], minPx: 0.9, maxPx: 1e3, A: [0.22, 0.38, 0.6], aH: 0.03, rH: 18, fwWidoczne: 26, fala: 0, drogowa: 1, rB: 0, plask: 0, podProgiem: 1 },
  { s0: [6, 6], minPx: 0.95, maxPx: 3, A: [0.12, 0.42, 1.0], aH: 0.04, rH: 28, fwWidoczne: 1e6, fala: 0, drogowa: 0, rB: 0, plask: 0, podProgiem: 1 },
  { s0: [6, 6], minPx: 0.9, maxPx: 3, A: [0.08, 0.26, 0.7], aH: 0.03, rH: 22, fwWidoczne: 1e6, fala: 0, drogowa: 0, rB: 0, plask: 0, podProgiem: 1 },
  { s0: [8, 8], minPx: 1.7, maxPx: 3, A: [1, 1, 1], aH: 0.1, rH: 60, fwWidoczne: 1e6, fala: 0, drogowa: 0, rB: 0, plask: 0, podProgiem: 0 },
  { s0: [18, 18], minPx: 1.8, maxPx: 3.2, A: [2.6, 3.2, 4.5], aH: 0.08, rH: 130, fwWidoczne: 1e6, fala: 0, drogowa: 0, rB: 44, plask: 0, podProgiem: 0 },
  { s0: [8, 8], minPx: 1.05, maxPx: 3, A: [0.8, 0.8, 1.6], aH: 0.06, rH: 40, fwWidoczne: 1e6, fala: 0, drogowa: 0, rB: 0, plask: 0, podProgiem: 1 }
]);

// Kurtyna: lampy korytarza K-7 rozchodzą się na trzy rzeczy. Po stronie napływu — dwa czerwone rzędy (bar z osobnych lamp, nie neonowa rura), po stronie
// odpływu — bursztynowy rząd domykający, a wokół osi przejazdu okrętu — dwa białe rzędy brzegów tymczasowego pasa startowego. Kod w opóźnieniu czerwieni
// (lpD.w): < 5 — bar, ≥ 10 — odpływ, ≥ 15 — brzeg pasa.
const RZEDY_BARU = Object.freeze([NODE.stopX - 50, NODE.stopX - 210, NODE.stopX - 370]);
const ROZSTAW_BARU = 84;      // przy zoomie 0,06 to 5 px: osobne lampy, a nie linia
const RZEDY_ODPLYWU = Object.freeze([NODE.boxHalf, NODE.boxHalf - 160]);
const ROZSTAW_PASA = 110;
const POL_PASA = 600;       // [j.] brzegi pasa startowego wokół osi przejazdu
const KOD_ODPLYW = 10;
const KOD_PAS = 20;
const ZASIEG_BURSZTYNU = 24000;
const SCIEZKA_PRZED_DZIOBEM = 4000;
const POL_KADLUBA = 900;

function mulberry(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Najbliższe K-7 dla kąta: indeks i różnica kątów [stopnie, −45…45]. */
function najblizszyK7(th, wyj) {
  const t = ((th % 360) + 360) % 360;
  const k = ((Math.round((t - 45) / 90) % 4) + 4) % 4;
  let d = t - (45 + 90 * k);
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  wyj.k = k;
  wyj.d = d;
}

// ---------------------------------------------------------------------------
// Rozmieszczenie (czysty JS, jedna tablica typowana)

function zbudujDane(siec) {
  const los = mulberry(20261106);
  const lampy = [];
  const kurtyna = [0, 1, 2, 3].map(() => [[], []]);
  const n7 = { k: 0, d: 0 };
  const dodaj = (o) => {
    lampy.push(o);
    return o;
  };
  const lampa = (x, y, tx, ty, rozst, kl, c, k7 = 0, dF = 0, faza = 0, ziarno = los()) => dodaj({ x, y, xb: x, yb: y, tx, ty, rozst, kl, k7, dF, faza, ziarno, c, op: -1 });

  /** Rząd na pierścieniu; `krok` dobity do całkowitej liczby lamp na obwód (bez szwu na s = 0). */
  const rzad = (r, krok, kl, c, cw, opcje = {}) => {
    const n = Math.round(TAU * r / krok);
    const dl = TAU * r / n;
    const pol = opcje.pol ?? 0;
    for (let i = 0; i < n; i++) {
      const th = ((i + pol) / n) * 360;
      najblizszyK7(th, n7);
      const dLuk = n7.d * DEG * r;
      const dF = cw === 0 ? -dLuk : dLuk;
      // Do kurtyny idzie korytarz i pas przed nim aż po linię stopu: bar ma stać na czystym, bez lamp spoczynkowych między rzędami.
      const wKorytarzu = dF > -(NODE.stopX + 40) && dF < NODE.boxHalf;
      if (wKorytarzu && opcje.korytarz === 'pusty') continue;
      if (wKorytarzu && opcje.korytarz === 'rzadszy' && i % 2) continue;
      const c0 = Math.cos(th * DEG);
      const s0 = Math.sin(th * DEG);
      // Faza fali kierunku: 20 okresów na obwód, zawsze w stronę ruchu.
      const faza = ((cw === 0 ? -th : th) / 360) * 20;
      const rozst = wKorytarzu && opcje.korytarz === 'rzadszy' ? dl * 2 : dl;
      const l = lampa(r * c0, r * s0, -s0, c0, rozst, kl, c, n7.k, dF, faza);
      if (wKorytarzu && opcje.korytarz !== 'pusty') {
        l.r = r;
        kurtyna[n7.k][cw].push(l);
      }
    }
  };

  // L1: boje krawędzi (biel) i krawędzi mediany (bursztyn), przesunięte o pół komórki, żeby z daleka nie składały się w szczeble.
  const wewM = HW.iL1 + HW.widths.L1 * 0.5;
  const zewM = HW.oL1 - HW.widths.L1 * 0.5;
  rzad(HW.edgeIn, 400, K.L1, BIEL, 0, { pol: 0.5 });
  rzad(wewM, 400, K.L1, BURSZTYN, 0, { pol: 0 });
  rzad(zewM, 400, K.L1, BURSZTYN, 1, { pol: 0.5 });
  rzad(HW.edgeOut, 400, K.L1, BIEL, 1, { pol: 0 });
  // L2: kocie oczy między pasami; w korytarzu K-7 co drugie (idą do kurtyny).
  rzad(HW.iL3 + HW.widths.L3 * 0.5, 100, K.L2, CHLOD, 0, { pol: 0, korytarz: 'rzadszy' });
  rzad(HW.iL2 + HW.widths.L2 * 0.5, 100, K.L2, CHLOD, 0, { pol: 0.5, korytarz: 'rzadszy' });
  rzad(HW.oL2 - HW.widths.L2 * 0.5, 100, K.L2, CHLOD, 1, { pol: 0, korytarz: 'rzadszy' });
  rzad(HW.oL3 - HW.widths.L3 * 0.5, 100, K.L2, CHLOD, 1, { pol: 0.5, korytarz: 'rzadszy' });
  // Rząd osi pasa: dopiero przy zbliżeniu, żeby w kadrze 1920 × 1080 j. nie było pustki.
  [[HW.iL1, 0], [HW.iL2, 0], [HW.iL3, 0], [HW.oL1, 1], [HW.oL2, 1], [HW.oL3, 1]].forEach(([r, cw], i) => {
    rzad(r, 150, K.OS, CHLOD, cw, { pol: (i % 3) * 0.33, korytarz: 'pusty' });
  });

  // L0: latarnie osi mediany, co ok. 3200 j.; sąsiednie ćwiartki w przeciwfazie.
  const nL0 = 122;
  for (let i = 0; i < nL0; i++) {
    const th = (i / nL0) * 360;
    najblizszyK7(th, n7);
    const c0 = Math.cos(th * DEG);
    const s0 = Math.sin(th * DEG);
    const dLuk = n7.d * DEG * HW.median;
    lampa(HW.median * c0, HW.median * s0, -s0, c0, 3200, K.L0, LATARNIA, n7.k, dLuk, 0, Math.floor(th / 90) % 2 ? 0.5 : 0);
  }

  // Strzałki z 7 lamp w każdym pasie (kierunek bez napisu), fazą rozsunięte między pasami.
  const STRZALKI = [[HW.iL1, 0, HW.widths.L1], [HW.iL2, 0, HW.widths.L2], [HW.iL3, 0, HW.widths.L3], [HW.oL1, 1, HW.widths.L1], [HW.oL2, 1, HW.widths.L2], [HW.oL3, 1, HW.widths.L3]];
  STRZALKI.forEach(([r, cw, szer], ip) => {
    const n = Math.round(TAU * r / 6400);
    const hw = szer * 0.42;
    const dlug = 420;
    const zn = cw === 0 ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const th = ((i + (ip % 3) * 0.31 + cw * 0.17) / n) * 360;
      najblizszyK7(th, n7);
      const dLuk = n7.d * DEG * r;
      if (Math.abs(dLuk) < NODE.stopX + 800) continue;
      const c0 = Math.cos(th * DEG);
      const s0 = Math.sin(th * DEG);
      const tx = -s0 * zn;
      const ty = c0 * zn;
      const dF = cw === 0 ? -dLuk : dLuk;
      for (let a = -3; a <= 3; a++) {
        const st = Math.abs(a);
        const wzdl = dlug * 0.5 - st * (dlug / 3);
        const pop = (a / 3) * hw;
        const x = r * c0 + tx * wzdl + c0 * pop;
        const y = r * s0 + ty * wzdl + s0 * pop;
        lampa(x, y, tx, ty, 1e4, K.STRZALKA, BIEL, n7.k, dF);
      }
    }
  });

  // Lampy wzdłuż ścieżek sieci.
  const pkt = { x: 0, y: 0, h: 0, k: 0 };
  const wzdluz = (sc, krok, fn, od = 0, doS = sc.probki.len) => {
    const q = sc.probki;
    const n = Math.max(1, Math.round((doS - od) / krok));
    let hint = 0;
    for (let i = 0; i <= n; i++) {
      const ps = od + (doS - od) * (i / n);
      hint = punktNaSciezce(q, ps, pkt, hint);
      fn(pkt.x, pkt.y, pkt.h, ps);
    }
  };
  const rMin = 51200;
  const krawedzie = (sc, krok, pol, c, kl = K.RAMPA) => {
    // Tranzyt biegnie aż do tunelu przy ringu (r ≈ 44 300), zatoka kończy się na podejściu grzebienia.
    const rOd = sc.id.startsWith('T') ? 44600 : rMin;
    wzdluz(sc, krok, (x, y, h) => {
      if (Math.hypot(x, y) < rOd) return;
      const tx = Math.cos(h);
      const ty = Math.sin(h);
      for (const b of [-1, 1]) lampa(x - ty * pol * b, y + tx * pol * b, tx, ty, krok, kl, c);
    });
  };
  const kierK7 = complexes();
  for (const p of siec.paths) {
    switch (p.kind) {
      case 'rampOff':
      case 'rampOn':
        krawedzie(p, 170, 150, CHLOD);
        break;
      case 'uturn':
        krawedzie(p, 200, 130, BURSZTYN, K.TOR);
        break;
      case 'gateOut':
        krawedzie(p, 420, 170, CHLOD);
        break;
      case 'gateIn': {
        krawedzie(p, 420, 170, CHLOD);
        // Oś alei: królik „do mnie”, kometa ku jezdni. Tylko odcinek promieniowy.
        const q = p.probki;
        let psKoniec = 0;
        for (let i = 0; i < q.n; i++) {
          if (Math.hypot(q.x[i], q.y[i]) < HW.edgeOut + 1600) { psKoniec = q.s[i]; break; }
        }
        wzdluz(p, 300, (x, y, h, ps) => {
          const l = lampa(x, y, Math.cos(h), Math.sin(h), 300, K.KROLIK, KROLIK);
          l.faza = ps / psKoniec;
        }, 0, psKoniec);
        // Dwie belki decyzyjne w poprzek alei i markery na osi (jeden rząd).
        const a = p.site;
        for (const rB of [70000, 76000]) {
          for (let i = -4; i <= 4; i++) {
            const m = hubToWorld(a, i * 110, rB - R0);
            lampa(m.x, m.y, -Math.sin(a * DEG), Math.cos(a * DEG), 110, K.RAMPA, BIEL);
          }
        }
        for (const [rM, c, faza] of [[104000, CHLOD, 0.0], [90000, BURSZTYN, 0.17], [72500, BIEL, 0.34]]) {
          for (const i of [-1, 0, 1]) {
            const m = hubToWorld(a, i * 300, rM - R0);
            najblizszyK7(a, n7);
            lampa(m.x, m.y, -Math.sin(a * DEG), Math.cos(a * DEG), 1e4, K.MARKER, c, n7.k, 0, 0, faza);
          }
        }
        // Nabieżnik między markerami: pary białych lamp.
        for (let rN = 92500; rN <= 102000; rN += 3000) {
          for (const i of [-1, 1]) {
            const m = hubToWorld(a, i * 60, rN - R0);
            lampa(m.x, m.y, -Math.sin(a * DEG), Math.cos(a * DEG), 1e4, K.TOR, BIEL);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  // Ścieżka zieleni: oś pasa Atlasa (x = −810 w hubie) przez korytarz każdego K-7; w spoczynku ledwie widoczna, „zakopana”.
  const xSc = NODE.boxLanes[1];
  kierK7.forEach((a, k) => {
    for (let z = 8700; z <= 25000; z += 140) {
      const m = hubToWorld(a, xSc, z);
      lampa(m.x, m.y, Math.cos(a * DEG), Math.sin(a * DEG), 140, K.SCIEZKA, ZIELEN, k, z);
    }
  });

  // Kurtyna: lampy z korytarza dzielą się po współrzędnej wzdłuż ruchu: najbliższe napływu idą do baru, najbliższe odpływu do rzędu domykającego, środkowe
  // na brzegi pasa startowego. W każdej grupie kolejność po promieniu, żeby lot rozchodził się wachlarzem. Bary po stronie napływu: z góry czerwone Z.
  kierK7.forEach((a, k) => {
    for (const cw of [0, 1]) {
      const r0 = cw === 0 ? HW.edgeIn : zewM;
      const r1 = cw === 0 ? wewM : HW.edgeOut;
      const rc = (r0 + r1) * 0.5;
      const pol = (r1 - r0) * 0.5;
      const lista = kurtyna[k][cw];
      lista.sort((p, q) => p.dF - q.dF);
      const wRzedzie = Math.round((r1 - r0 - 60) / ROZSTAW_BARU) + 1;
      const wBarze = wRzedzie * RZEDY_BARU.length;
      const wPasie = (Math.round((r1 - r0 - 40) / ROZSTAW_PASA) + 1) * 2;
      const grupaBar = lista.slice(0, wBarze);
      const grupaPas = lista.slice(wBarze, wBarze + wPasie);
      const grupaOdplyw = lista.slice(wBarze + wPasie);
      const naKat = (d) => (cw === 0 ? a + d / rc / DEG : a - d / rc / DEG);
      const przypisz = (grupa, miejsca) => {
        grupa.sort((p, q) => p.r - q.r);
        miejsca.sort((p, q) => p.r - q.r);
        grupa.forEach((l, i) => {
          const m = miejsca[Math.min(i, miejsca.length - 1)];
          l.xb = m.x;
          l.yb = m.y;
          l.op = m.op;
        });
      };
      const naPromieniu = (r, d, op) => {
        const th = naKat(d);
        return { r, x: r * Math.cos(th * DEG), y: r * Math.sin(th * DEG), op };
      };
      const mBar = [];
      RZEDY_BARU.forEach((d) => {
        for (let j = 0; j < wRzedzie; j++) {
          const r = r0 + 30 + (r1 - r0 - 60) * (j / (wRzedzie - 1));
          mBar.push(naPromieniu(r, d, (Math.abs(r - rc) / pol) * 0.4));
        }
      });
      const mPas = [];
      for (const x of [NODE.boxLanes[1] - POL_PASA, NODE.boxLanes[1] + POL_PASA]) {
        const nP = wPasie / 2;
        for (let j = 0; j < nP; j++) {
          const r = r0 + 20 + (r1 - r0 - 40) * (j / (nP - 1));
          const zh = Math.sqrt(Math.max(0, r * r - x * x)) - R0;
          const p = hubToWorld(a, x, zh);
          mPas.push({ r, x: p.x, y: p.y, op: KOD_PAS });
        }
      }
      const mOdp = [];
      const nO = Math.ceil(grupaOdplyw.length / RZEDY_ODPLYWU.length);
      RZEDY_ODPLYWU.forEach((d, ir) => {
        for (let j = 0; j < nO; j++) {
          const r = r0 + 30 + (r1 - r0 - 60) * ((j + ir * 0.5) / Math.max(1, nO - 0.5));
          mOdp.push(naPromieniu(r, -d, KOD_ODPLYW));
        }
      });
      przypisz(grupaBar, mBar);
      przypisz(grupaPas, mPas);
      przypisz(grupaOdplyw, mOdp);
    }
  });

  const STRIDE = 16;
  const dane = new Float32Array(lampy.length * STRIDE);
  lampy.forEach((l, i) => {
    const o = i * STRIDE;
    dane[o] = l.x; dane[o + 1] = l.y; dane[o + 2] = l.xb; dane[o + 3] = l.yb;
    dane[o + 4] = l.tx; dane[o + 5] = l.ty; dane[o + 6] = l.rozst; dane[o + 7] = l.kl;
    dane[o + 8] = l.k7; dane[o + 9] = l.dF; dane[o + 10] = l.faza; dane[o + 11] = l.ziarno;
    dane[o + 12] = l.c[0]; dane[o + 13] = l.c[1]; dane[o + 14] = l.c[2]; dane[o + 15] = l.op;
  });
  return { dane, ile: lampy.length, STRIDE, zKorpusem: lampy.filter((l) => KLASY[l.kl].rB > 0) };
}

// ---------------------------------------------------------------------------
// Materiał lamp

const v4 = (a, b, c, d) => new THREE.Vector4(a, b, c, d);
const uP0 = uniformArray(KLASY.map((k) => v4(k.s0[0], k.s0[1], k.minPx, k.maxPx)), 'vec4').setName('uLpP0');
const uP1 = uniformArray(KLASY.map((k) => v4(k.A[0], k.A[1], k.A[2], k.aH)), 'vec4').setName('uLpP1');
const uP2 = uniformArray(KLASY.map((k) => v4(k.rH, k.fwWidoczne, k.fala, k.drogowa)), 'vec4').setName('uLpP2');
const uP3 = uniformArray(KLASY.map((k) => v4(k.rB, k.plask, k.podProgiem, 0)), 'vec4').setName('uLpP3');
// Stan K-7: x czas kurtyny 0…3, y czas czerwieni baru, z czoło bursztynu [j.], w czoło powrotu bieli [j.].
const uK7 = uniformArray([v4(0, 0, 1e6, 1e6), v4(0, 0, 1e6, 1e6), v4(0, 0, 1e6, 1e6), v4(0, 0, 1e6, 1e6)], 'vec4').setName('uLpK7');
// x czoło zielonej fali zwolnienia [j.], y fala włączona, z czerwone (latarnie), w —
const uK7b = uniformArray([v4(-1e5, 0, 0, 0), v4(-1e5, 0, 0, 0), v4(-1e5, 0, 0, 0), v4(-1e5, 0, 0, 0)], 'vec4').setName('uLpK7b');
// Atlas: indeks K-7, z dziobu, z rufy, siła ścieżki.
const uAtlas = uniform(new THREE.Vector4(3, 0, 0, 0)).setName('uLpAtlas');
// Promień Ziemi: w kamerze kinowej lampy za tarczą planety gasną (pass ortho nie ma głębi planet).
const uRZiemi = uniform(30000).setName('uLpRZiemi');

function zbudujMaterialLamp() {
  const iA = attribute('lpA', 'vec4');   // x, y dom; x, y w barze
  const iB = attribute('lpB', 'vec4');   // styczna (x, y), rozstaw w rzędzie [j.], klasa
  const iC = attribute('lpC', 'vec4');   // K-7, współrzędna wzdłuż ruchu od osi K-7 [j.] (ścieżka: z w hubie), faza, ziarno
  const iD = attribute('lpD', 'vec4');   // barwa spoczynkowa, opóźnienie czerwieni (≥ 0: lampa kurtyny)

  const vW = varyingProperty('vec2', 'vLpW');      // odsunięcie od środka lampy [j.]: wzdłuż, w poprzek
  const vQ = varyingProperty('vec2', 'vLpQ');      // róg kwadu ±1
  const vSig = varyingProperty('vec2', 'vLpSig');  // sigma wzdłuż, w poprzek [j.]
  const vRdz = varyingProperty('vec3', 'vLpRdz');  // barwa × jasność rdzenia
  const vHal = varyingProperty('vec3', 'vLpHal');  // barwa × jasność halo
  const vPar = varyingProperty('vec4', 'vLpPar');  // promień halo [j.], widoczność korpusu, płaski szczyt, ślad piksela
  const vRB = varyingProperty('float', 'vLpRB');   // promień korpusu [j.]

  const pozycja = Fn(() => {
    const F = (e) => { const v = float(0).toVar(); v.assign(e); return v; };
    const V2 = (e) => { const v = vec2(0).toVar(); v.assign(e); return v; };
    const V3 = (e) => { const v = vec3(0).toVar(); v.assign(e); return v; };
    const V4 = (e) => { const v = vec4(0).toVar(); v.assign(e); return v; };
    const q = positionGeometry.xy;
    const kl = iB.w;
    const klI = kl.toInt();
    const P0 = V4(uP0.element(klI));
    const P1 = V4(uP1.element(klI));
    const P2 = V4(uP2.element(klI));
    const P3 = V4(uP3.element(klI));
    const k7I = iC.x.toInt();
    const S7 = V4(uK7.element(k7I));
    const Z7 = V4(uK7b.element(k7I));
    const jedna = float(1);
    const jest = (k) => F(jedna.sub(step(0.5, abs(kl.sub(k)))));
    const jestL0 = jest(K.L0);
    const jestMarker = jest(K.MARKER);
    const jestKrolik = jest(K.KROLIK);
    const jestSciezka = jest(K.SCIEZKA);

    // Kurtyna: lot z domu do baru, z rozrzutem startu 0–0,6 s; ten sam przebieg wstecz przy powrocie.
    const kur = F(step(0, iD.w));
    const g = F(clamp(S7.x.sub(iC.w.mul(0.6)).div(2.4), 0, 1));
    const bar = F(g.mul(g).mul(float(3).sub(g.mul(2))).mul(kur));
    const srodek = V2(mix(iA.xy, iA.zw, bar));

    // Układ lampy na płaszczyźnie widoku: kamera gry — osie sceny, kamera kinowa — billboard, a styczna rzutowana (rząd zostaje rzędem).
    const Vm = cameraViewMatrix;
    const cx = V3(vec3(Vm.element(0).x, Vm.element(1).x, Vm.element(2).x));
    const cy = V3(vec3(Vm.element(0).y, Vm.element(1).y, Vm.element(2).y));
    const lot = V2(iA.zw.sub(iA.xy));
    const lotN = V2(lot.div(max(length(lot), 1)));
    const fLot = F(float(4).mul(bar).mul(jedna.sub(bar)).mul(kur));
    const tBar = V2(normalize(iA.zw));
    const t2 = V2(iB.xy.mul(jedna.sub(bar)).add(tBar.mul(bar)).add(lotN.mul(fLot).mul(3)));
    const t3 = V3(vec3(t2, 0));
    const tv0 = V2(vec2(dot(t3, cx), dot(t3, cy)));
    const rzutL = F(length(tv0));
    const rzut = F(rzutL.div(max(length(t2), 1e-3)));
    const tv = V2(tv0.div(max(rzutL, 1e-3)));
    const nv = V2(vec2(tv.y.negate(), tv.x));
    // Skrót rzędów w poprzek (kamera kinowa, spojrzenie po stycznej płaszczyźnie): rzędy zlewają się w jeden piksel — suma nie może się przepalić.
    const n3 = V3(vec3(t2.y.negate(), t2.x, 0));
    const rzutN = F(length(vec2(dot(n3, cx), dot(n3, cy))).div(max(length(t2), 1e-3)));

    // Ślad piksela w miejscu lampy, przesłonięcie przez planetę.
    const lv = V4(modelViewMatrix.mul(vec4(srodek, 0, 1)));
    const cv = V4(modelViewMatrix.mul(vec4(0, 0, 0, 1)));
    const zv = lv.z;
    const fw = F(max(mix(jedna, zv.negate(), U.persp).mul(U.jPxNaW), 1e-3));
    const zaPlaneta = F(zaKula(lv.xyz, cv.xyz, uRZiemi));
    const gestoscRzedow = F(mix(clamp(float(320).mul(rzutN).div(fw).div(2.6), 0.2, 1), jedna, jestL0.add(jestMarker)));

    // Jasność klasy po zoomie: jeden wzór. Z daleka spada wolniej niż fizyka, żeby rząd nie zginął (1/fw zamiast 1/fw²).
    const bliskoM = F(smoothstep(2, 4.2, fw));
    const Aodl = F(mix(P1.y, P1.x, smoothstep(7, 30, fw)).mul(min(jedna, float(30).div(fw))));
    const widoczne = F(jedna.sub(smoothstep(P2.y.mul(0.66), P2.y, fw)).mul(zaPlaneta));
    const nierownosc = F(float(0.86).add(iC.w.mul(0.28)));
    const Abaza = F(mix(P1.z, Aodl, bliskoM).mul(widoczne).mul(mix(jedna, nierownosc, step(jestL0.add(jestMarker).add(jestKrolik).add(jestSciezka), 0.5))));

    // Fala kierunku: wolna, ≈ 8 s między grzbietami, 2400 j./s w stronę ruchu.
    const gx = F(fract(iC.z.sub(U.czas.mul(0.125))).sub(0.5).mul(16));
    const mFala = F(jedna.add(exp(gx.mul(gx).negate()).mul(0.3).mul(P2.z)));

    // Fala bursztynu od osi K-7 z ciemnym czołem, potem powrót bieli; zwolnienie: zieleń z prądem.
    const dA = F(abs(iC.y));
    const strefa = F(jedna.sub(smoothstep(ZASIEG_BURSZTYNU - 1000, ZASIEG_BURSZTYNU + 500, dA)).mul(P2.w));
    const przed = F(jedna.sub(smoothstep(S7.z.sub(120), S7.z.add(120), dA)));
    const za = F(smoothstep(S7.w.sub(120), S7.w.add(120), dA));
    // Brzeg pasa startowego (kod ≥ 15) w locie przechodzi w biel: to jedyne lampy bez bursztynu przy zamknięciu.
    const naPasie = F(step(15, iD.w).mul(bar));
    const bursz = F(strefa.mul(przed).mul(za).mul(jedna.sub(naPasie)));
    const czolo1 = F(dA.sub(S7.z).div(320));
    const czolo2 = F(dA.sub(S7.w).div(320));
    const ciemne = F(clamp(exp(czolo1.mul(czolo1).negate()).add(exp(czolo2.mul(czolo2).negate())), 0, 1).mul(strefa).mul(0.85));
    // Zieleń kończy się za korytarzem: po przejściu jezdnia wraca do spoczynku, a nie niesie fali dookoła Ziemi.
    const zw = F(smoothstep(Z7.x.sub(900), Z7.x, iC.y).mul(jedna.sub(smoothstep(Z7.x, Z7.x.add(90), iC.y))).mul(jedna.sub(smoothstep(3200, 4600, iC.y))).mul(Z7.y).mul(P2.w));

    // Czerwień: bar od środka ku krawędziom; latarnie w ±9000 j. — czerwony błysk 1,5 Hz.
    const czerw = F(kur.mul(smoothstep(iD.w, iD.w.add(0.12), S7.y)));
    const czerwL0 = F(jestL0.mul(jedna.sub(smoothstep(8800, 9200, dA))).mul(Z7.z));
    const fr = F(fract(U.czas.mul(1.5)));
    const blyskR = F(smoothstep(0, 0.12, fr).mul(jedna.sub(smoothstep(0.45, 0.62, fr))));

    // Rytmy: latarnie i markery stale 45 %, długi błysk 100 %; oba stany nad progiem, więc nie ma przejścia przez próg.
    const fL = F(fract(U.czas.div(6).add(iC.w)));
    const blyskL = F(smoothstep(0, 0.04, fL).mul(jedna.sub(smoothstep(0.17, 0.23, fL))));
    const mRytm = F(mix(jedna, blyskL.mul(0.55).add(0.45), jestL0.add(jestMarker)));
    // Królik „do mnie”: 1,6 s biegu + 0,4 s przerwy, kometa ku jezdni; faza = 0 daleko, 1 przy jezdni.
    const dxK = F(fract(U.czas.mul(0.5)).div(0.8).sub(iC.z));
    // AGENT: max(…, 0) w wykładniku obowiązkowy — faza innych klas sięga 20, exp(+260) = inf, a 0 · inf = NaN zalewa rdzeń przez min().
    const kom = F(step(0, dxK).mul(exp(max(dxK, 0).mul(-13))));
    const mKrolik = F(mix(jedna, kom.mul(4.5).add(0.03), jestKrolik));
    // Ścieżka zieleni: okno od rufy − 400 j. do dziobu + zasięg, biały królik 2 Hz w stronę lotu; poza oknem „zakopana”.
    const naK7 = F(jedna.sub(step(0.5, abs(iC.x.sub(uAtlas.x)))));
    const zL = iC.y;
    const okno = F(smoothstep(uAtlas.z.sub(520), uAtlas.z.sub(400), zL).mul(jedna.sub(smoothstep(uAtlas.y.add(SCIEZKA_PRZED_DZIOBEM - 500), uAtlas.y.add(SCIEZKA_PRZED_DZIOBEM), zL))));
    const pali = F(naK7.mul(uAtlas.w).mul(okno));
    const fS = F(fract(zL.div(2400).sub(U.czas.mul(2))));
    const komS = F(exp(jedna.sub(fS).mul(-5)).mul(pali));
    const zakopana = F(jedna.sub(smoothstep(18200, 18800, zL)).mul(0.016));
    const mSciezka = F(mix(jedna, pali.mul(komS.mul(1.5).add(1)).add(zakopana.mul(jedna.sub(pali))), jestSciezka));

    // Szczyt: reguła progu dla klas podProgiem — przy śladzie ≥ ~4 j./px szczyt ≤ 0,8 bez względu na falę i nierówność.
    const Asur = F(Abaza.mul(mFala).mul(jedna.sub(ciemne)).mul(mRytm).mul(mKrolik).mul(mSciezka));
    const limit = F(mix(float(99), float(0.8), bliskoM.mul(P3.z)));
    const A = F(min(Asur, limit));

    const kBaza = V3(mix(mix(mix(iD.rgb, kolor(BIEL), naPasie), kolor(BURSZTYN), bursz), kolor(ZIELEN), zw));
    const kRdz = V3(mix(kBaza, kolor(KROLIK), komS.mul(0.85).mul(jestSciezka)));
    const stop = kolor(BARWY.stop);
    // Czerwień baru: z daleka szczyt luminancji 0,8, więc ostre osobne lampy bez bloomu (nasycenie robi krzyk, nie plama); z bliska rdzeń do 3 px nad progiem.
    const mStop = F(mix(float(1.5), float(0.6), bliskoM));
    const kFin = V3(mix(mix(kRdz.mul(A), stop.mul(mStop), czerw), stop.mul(blyskR).mul(1.25), czerwL0).mul(gestoscRzedow).mul(zaPlaneta));

    // Sigma z dolnym progiem w px; przy zlaniu w rząd (rozstaw ok. 3–5 px) kropki przechodzą w ciągły włos z tą samą energią.
    const minW = F(mix(P0.z, float(1.7), czerwL0).mul(fw));
    const maxW = F(max(mix(P0.w, float(3), max(czerw, czerwL0)).mul(fw), minW));
    // W barze wszystkie lampy są jednakowo okrągłe (kapsułka kociego oka w rzędzie czerwieni czytałaby się jak kreska neonu).
    const sDot = F(clamp(mix(P0.x, float(6), czerw), minW, maxW));
    const sV = F(clamp(mix(P0.y, float(6), czerw), minW, maxW));
    const rozstBar = F(mix(float(ROZSTAW_BARU), float(ROZSTAW_PASA), step(5, iD.w)));
    const dW = F(max(mix(iB.z, rozstBar, bar).mul(max(rzut, 0.03)), 1e-3));
    const kropki = F(smoothstep(3.2, 5.5, dW.div(fw)));
    const sLinia = F(max(dW.mul(0.6), minW));
    const sS0 = F(mix(sLinia, sDot, kropki));
    const eLinia = F(sDot.div(sLinia).mul(min(jedna, dW.div(sDot.mul(2.5066)))));
    // Lampa w locie: krótka smuga wzdłuż lotu (dmuch korekcyjny), energia zachowana.
    const sS = F(sS0.add(fLot.mul(fw.mul(1.6).add(26))));
    const eMerge = F(mix(eLinia, jedna, kropki).mul(sS0.div(sS)));

    // Halo pod progiem: promień właściwy, z daleka nie mniej niż ~2,4 px; lampy baru mają szerszą, nasyconą poświatę (to ona mówi „stój”, nie rura neonu).
    const rH = F(mix(max(P2.x, fw.mul(2.4)), max(float(60), fw.mul(6)), czerw));
    const aH = F(P1.w.mul(min(jedna, float(30).div(fw))).mul(widoczne));
    const kHal = V3(mix(mix(kRdz.mul(aH).mul(mRytm).mul(mKrolik).mul(mSciezka), stop.mul(0.016), czerw), stop.mul(blyskR).mul(0.025), czerwL0).mul(gestoscRzedow));

    // Rozmiar kwadu; klasa zgaszona zwija się do zera (bez fragmentów). Okno w fragmencie jest koliste, więc kwad ma zapas na rogi.
    const rB = P3.x;
    const widzKorp = F(smoothstep(6, 11, rB.mul(2).div(fw)));
    const hs = F(max(max(sS.mul(3.6), rH.mul(2)), rB.mul(1.45)).mul(step(1e-4, widoczne)));
    const hv = F(max(max(sV.mul(3.6), rH.mul(2)), rB.mul(1.45)).mul(step(1e-4, widoczne)));

    vW.assign(vec2(q.x.mul(hs), q.y.mul(hv)));
    vQ.assign(q);
    vSig.assign(vec2(sS, sV));
    vRdz.assign(clamp(kFin.mul(eMerge), vec3(0), vec3(14)));
    vHal.assign(clamp(kHal, vec3(0), vec3(1.5)));
    vPar.assign(vec4(rH, widzKorp.mul(step(0.5, rB)), P3.y.mul(jedna.sub(smoothstep(0.5, 1.3, fw))), fw));
    vRB.assign(rB);

    const ox = tv.mul(q.x.mul(hs)).add(nv.mul(q.y.mul(hv)));
    return vec3(srodek, 0).add(cx.mul(ox.x)).add(cy.mul(ox.y));
  })();

  const fragment = Fn(() => {
    const F = (e) => { const v = float(0).toVar(); v.assign(e); return v; };
    const jedna = float(1);
    const xs = F(vW.x.div(vSig.x));
    const xv = F(vW.y.div(vSig.y));
    const r2 = F(xs.mul(xs).add(xv.mul(xv)));
    // Rdzeń: Gauss; kapsułka z bliska to szkło: wyraźny brzeg, przygaszone wnętrze i świecący żarnik wzdłuż osi (bez tego biała plama).
    const gauss = exp(r2.mul(-0.5));
    const szklo = exp(r2.mul(r2).mul(0.42).negate().mul(0.5)).mul(0.34).add(exp(xs.mul(xs).mul(1.1).add(xv.mul(xv).mul(9)).mul(-0.5)).mul(0.66));
    const rdz = mix(gauss, szklo, vPar.z);
    const dl = F(length(vW));
    const h = F(dl.div(vPar.x));
    const h2 = F(jedna.add(h.mul(h)));
    const okno = F(jedna.sub(smoothstep(0.62, 1, length(vQ))));
    const halo = jedna.div(h2.mul(h2)).mul(okno);
    // Korpus boi (matowa stal, pod progiem): sześciokąt z rantem i oprawa przy soczewce; światło tylko ze Słońca i własnej lampy.
    // Soczewka lampy na oprawie: szklany dysk pod progiem (na zoomie ≥ ~1), z bliska pierścienie Fresnela; rozgrzany rdzeń zostaje punktem do 3 px.
    const fwB = vPar.w;
    const rL = F(max(vRB, 1).mul(0.34));
    const dysk = jedna.sub(smoothstep(rL.sub(fwB), rL.add(fwB), dl));
    const fresnel = float(1).add(sin(dl.div(rL).mul(27)).mul(0.24).mul(smoothstep(9, 22, rL.div(fwB))));
    const korpus = vHal.mul(dysk).mul(fresnel).mul(6.5).mul(vPar.y);
    const wyj = vRdz.mul(rdz).mul(okno).add(vHal.mul(halo)).add(korpus);
    return vec4(clamp(wyj, vec3(0), vec3(14)), 1);
  })();
  return { pozycja, fragment };
}

// ---------------------------------------------------------------------------
// Korpusy boi: matowa stal, ciemna (L ≤ 0,08), światło tylko ze Słońca. Rysowane pod kwadami lamp, nieprzezroczyste (zasłaniają gwiazdy), bez głębi:
// od góry kolejność trójkątów w partii wystarcza (płetwy, kadłub, oprawa), tylne ściany odcina strona. Lecą ze swoją lampą (te same pola kurtyny).

function geometriaKorpusu() {
  const pos = [];
  const nor = [];
  const pas = [];
  const tri = (a, b, c, n, p = 0) => {
    pos.push(...a, ...b, ...c);
    nor.push(...n, ...n, ...n);
    pas.push(p, p, p);
  };
  const norm3 = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const krzyz = (a, b, c) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    return norm3([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
  };
  const quad = (a, b, c, d, p = 0) => {
    const n = krzyz(a, b, c);
    tri(a, b, c, n, p);
    tri(a, c, d, n, p);
  };
  const obw = (r, z, n, i, faza = 0) => {
    const k = ((i + faza) / n) * TAU;
    return [r * Math.cos(k), r * Math.sin(k), z];
  };
  // Płetwy pozycjonujące: niskie, trzy co 120°, z rozszerzoną stopką.
  for (let f = 0; f < 3; f++) {
    const k = (f / 3) * TAU + Math.PI / 6;
    const cx = Math.cos(k);
    const sy = Math.sin(k);
    const P = (u, v, z) => [cx * u - sy * v, sy * u + cx * v, z];
    quad(P(0.7, -0.13, 0.08), P(1.42, -0.09, 0.05), P(1.42, 0.09, 0.05), P(0.7, 0.13, 0.08));
    quad(P(1.42, -0.2, 0.06), P(1.68, -0.2, 0.04), P(1.68, 0.2, 0.04), P(1.42, 0.2, 0.06));
  }
  // Kadłub: ścięty sześciokąt, na dachu pas odblaskowy i pokrywa.
  const H = 6;
  for (let i = 0; i < H; i++) {
    const a0 = obw(1, 0, H, i, 0.5);
    const a1 = obw(1, 0, H, i + 1, 0.5);
    const b0 = obw(0.76, 0.32, H, i, 0.5);
    const b1 = obw(0.76, 0.32, H, i + 1, 0.5);
    quad(a0, a1, b1, b0);
    const c0 = obw(0.68, 0.32, H, i, 0.5);
    const c1 = obw(0.68, 0.32, H, i + 1, 0.5);
    quad(b0, b1, c1, c0);
    const d0 = obw(0.6, 0.32, H, i, 0.5);
    const d1 = obw(0.6, 0.32, H, i + 1, 0.5);
    quad(c0, c1, d1, d0, 1);
    const e0 = obw(0.5, 0.32, H, i, 0.5);
    const e1 = obw(0.5, 0.32, H, i + 1, 0.5);
    quad(d0, d1, e1, e0);
  }
  // Oprawa soczewki: ośmiokątny kołnierz z fazką, wokół dysku lampy.
  const O = 8;
  for (let i = 0; i < O; i++) {
    const a0 = obw(0.5, 0.32, O, i);
    const a1 = obw(0.5, 0.32, O, i + 1);
    const b0 = obw(0.41, 0.5, O, i);
    const b1 = obw(0.41, 0.5, O, i + 1);
    quad(a0, a1, b1, b0);
    const c = [0, 0, 0.5];
    tri(b0, b1, c, [0, 0, 1]);
  }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), pas: new Float32Array(pas) };
}

function zbudujKorpusy(lista) {
  const geo = geometriaKorpusu();
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(geo.pos, 3));
  g.setAttribute('kpN', new THREE.BufferAttribute(geo.nor, 3));
  g.setAttribute('kpP', new THREE.BufferAttribute(geo.pas, 1));
  const STRIDE = 10;
  const dane = new Float32Array(lista.length * STRIDE);
  lista.forEach((l, i) => {
    const o = i * STRIDE;
    dane[o] = l.x; dane[o + 1] = l.y; dane[o + 2] = l.xb; dane[o + 3] = l.yb;
    dane[o + 4] = l.tx; dane[o + 5] = l.ty; dane[o + 6] = KLASY[l.kl].rB; dane[o + 7] = l.ziarno;
    dane[o + 8] = l.k7; dane[o + 9] = l.op >= 0 ? 1 : 0;
  });
  const bufor = new THREE.InstancedInterleavedBuffer(dane, STRIDE, 1);
  g.setAttribute('kpA', new THREE.InterleavedBufferAttribute(bufor, 4, 0));
  g.setAttribute('kpB', new THREE.InterleavedBufferAttribute(bufor, 4, 4));
  g.setAttribute('kpC', new THREE.InterleavedBufferAttribute(bufor, 2, 8));
  g.instanceCount = lista.length;

  const iA = attribute('kpA', 'vec4');
  const iB = attribute('kpB', 'vec4');
  const iC = attribute('kpC', 'vec2');
  const aN = attribute('kpN', 'vec3');
  const aP = attribute('kpP', 'float');
  const vN = varyingProperty('vec3', 'vKpN');
  const vP = varyingProperty('float', 'vKpP');
  const pozycja = Fn(() => {
    const F = (e) => { const v = float(0).toVar(); v.assign(e); return v; };
    const p = positionGeometry;
    const S7 = uK7.element(iC.x.toInt());
    const gt = F(clamp(S7.x.sub(iB.w.mul(0.6)).div(2.4), 0, 1));
    const bar = F(gt.mul(gt).mul(float(3).sub(gt.mul(2))).mul(iC.y));
    const srodek = vec2(0).toVar();
    srodek.assign(mix(iA.xy, iA.zw, bar));
    const lv = vec4(0).toVar();
    lv.assign(modelViewMatrix.mul(vec4(srodek, 0, 1)));
    const cv = vec4(0).toVar();
    cv.assign(modelViewMatrix.mul(vec4(0, 0, 0, 1)));
    const fw = F(max(mix(float(1), lv.z.negate(), U.persp).mul(U.jPxNaW), 1e-3));
    // Wyłania się z czerni: poniżej ~6 px średnicy zwija się do zera; lampa bez korpusu (promień 0) nie rysuje nic.
    const skala = F(iB.z.mul(smoothstep(6, 10, iB.z.mul(2).div(fw))).mul(zaKula(lv.xyz, cv.xyz, uRZiemi)));
    const tx = iB.x;
    const ty = iB.y;
    vN.assign(vec3(aN.x.mul(tx).sub(aN.y.mul(ty)), aN.x.mul(ty).add(aN.y.mul(tx)), aN.z));
    vP.assign(aP);
    return vec3(srodek.x.add(p.x.mul(tx).sub(p.y.mul(ty)).mul(skala)), srodek.y.add(p.x.mul(ty).add(p.y.mul(tx)).mul(skala)), p.z.mul(skala));
  })();
  const fragment = Fn(() => {
    const swiatlo = max(dot(normalize(vN), normalize(U.slonce)), 0);
    const stal = vec3(0.05, 0.055, 0.063);
    const odblask = vec3(0.13, 0.105, 0.07);
    const baza = mix(stal, odblask, vP);
    return vec4(baza.mul(swiatlo.mul(1.25).add(0.2)), 1);
  })();
  const m = new THREE.NodeMaterial();
  m.name = 'lampy-korpusy';
  m.lights = false;
  m.fog = false;
  m.transparent = false;
  m.depthWrite = false;
  m.depthTest = false;
  m.side = THREE.FrontSide;
  m.positionNode = pozycja;
  m.fragmentNode = fragment;
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3.5;
  mesh.name = 'LampyKorpusy';
  return { mesh, g, ile: lista.length };
}

// ---------------------------------------------------------------------------
// Poświata jezdni: suma halo jako bardzo słaba masa (L ~0,01–0,02), bez asfaltu i bez ostrych krawędzi; z daleka całka ruchu pod progiem.

function zbudujPoswiate(ctx) {
  const pole = ctx.pole.tekstura;
  const aSV = attribute('aSV', 'vec2');
  const aMeta = attribute('aMeta', 'vec4');
  const vV = varying(aSV.y, 'vLpPV');
  const vM = varying(aMeta, 'vLpPM');
  const vP = varying(positionLocal.xy, 'vLpPP');
  const rodzaj = vM.x;
  const pol = vM.y;
  const r = length(vP);
  const fw = fwidth(r);
  const glowna = float(1).sub(step(1.5, rodzaj));
  const nazew = step(0.5, rodzaj);
  const profil = float(1).sub(smoothstep(pol.sub(80), pol.add(240), abs(vV))).mul(glowna);
  // Masa z sumy halo: mocniej przy rzędach boi, między nimi cień.
  const rBiel = mix(float(HW.edgeIn), float(HW.edgeOut), nazew);
  const rBursz = mix(float(HW.iL1 + HW.widths.L1 * 0.5), float(HW.oL1 - HW.widths.L1 * 0.5), nazew);
  const dB = r.sub(rBiel).div(250);
  const dM = r.sub(rBursz).div(250);
  const masa = kolor(BIEL).mul(exp(dB.mul(dB).negate()).mul(0.012).add(0.0045))
    .add(kolor(BURSZTYN).mul(exp(dM.mul(dM).negate()).mul(0.005)));
  // Za tarczą planety (kamera kinowa) poświata gaśnie razem z lampami; dosyć próby na wierzchołek wstęgi.
  const vZaPl = varying(zaKula(modelViewMatrix.mul(vec4(positionLocal, 1)).xyz, modelViewMatrix.mul(vec4(0, 0, 0, 1)).xyz, uRZiemi), 'vLpPZ');
  const oddal = float(1).sub(smoothstep(0.15, 0.6, U.zoom).mul(0.6));
  // Ruch: 20 % energii rzeki, tylko z daleka, pod progiem.
  const pasy = [
    { rW: HW.iL1, rZ: HW.oL1, sz: 150, w: 0.5 },
    { rW: HW.iL2, rZ: HW.oL2, sz: 150, w: 1.5 },
    { rW: HW.iL3, rZ: HW.oL3, sz: 90, w: 2.5 }
  ];
  const u = atan(vP.y, vP.x).div(PI2);
  const u01 = u.sub(u.floor());
  let suma = float(0);
  for (const p of pasy) {
    const rc = mix(float(p.rW), float(p.rZ), nazew);
    const wiersz = nazew.mul(3).add(p.w).div(6);
    const pr = texture(pole, vec2(u01, wiersz)).level(0);
    const d = r.sub(rc);
    const sig0 = float(p.sz).mul(0.6);
    const sig = max(sig0, fw.mul(1.1));
    const bok = exp(d.mul(d).div(sig.mul(sig)).mul(-0.5)).mul(sig0.div(sig));
    suma = suma.add(bok.mul(pr.r.mul(5).clamp(0, 2.5)));
  }
  const dalekoM = float(1).sub(smoothstep(0.045, 0.075, U.zoom));
  const barwaRuchu = mix(kolor(BARWY.ciepla), kolor(BARWY.zimna), nazew);
  const rzeka = barwaRuchu.mul(suma).mul(0.084).mul(dalekoM);
  const wyj = masa.mul(profil).mul(oddal).add(rzeka.mul(glowna)).mul(vZaPl);
  const m = materialAddytywny(vec4(clamp(wyj, vec3(0), vec3(0.7)), 1), null, 'lampy-poswiata');
  const mesh = new THREE.Mesh(ctx.geomWstegi, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.name = 'LampyPoswiata';
  return mesh;
}

// ---------------------------------------------------------------------------

export function utworzLampy(ctx) {
  const { dane, ile, STRIDE, zKorpusem } = zbudujDane(ctx.siec);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const bufor = new THREE.InstancedInterleavedBuffer(dane, STRIDE, 1);
  g.setAttribute('lpA', new THREE.InterleavedBufferAttribute(bufor, 4, 0));
  g.setAttribute('lpB', new THREE.InterleavedBufferAttribute(bufor, 4, 4));
  g.setAttribute('lpC', new THREE.InterleavedBufferAttribute(bufor, 4, 8));
  g.setAttribute('lpD', new THREE.InterleavedBufferAttribute(bufor, 4, 12));
  g.instanceCount = ile;
  const graf = zbudujMaterialLamp();
  const mesh = new THREE.Mesh(g, materialAddytywny(graf.fragment, graf.pozycja, 'lampy-nocne'));
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.name = 'LampyNocne';
  ctx.grupa.add(mesh);
  const poswiata = zbudujPoswiate(ctx);
  ctx.grupa.add(poswiata);
  const korpusy = zbudujKorpusy(zKorpusem);
  ctx.grupa.add(korpusy.mesh);
  uRZiemi.value = resolveRingPlanetWorldRadius(ctx.ziemia);

  const a7 = uK7.array;
  const b7 = uK7b.array;
  return {
    id: 'lampy',
    nazwa: 'Nocne Podejście',
    opis: 'sama droga z lamp na czerni: kurtyna i ścieżka zieleni przy K-7',
    siatki: [mesh, poswiata, korpusy.mesh],
    podklad: 0.82,
    podkladRamp: 0.5,
    tory: 0,
    barBazy: 0,
    promienZiemi: resolveRingPlanetWorldRadius(ctx.ziemia),
    aktualizuj(kl) {
      // Korpusy poniżej zoomu ~0,12 są mniejsze niż 6 px: nie ma po co liczyć ich wierzchołków (kamera kinowa — próg z przybliżonego zoomu).
      korpusy.g.instanceCount = kl.zoom > 0.11 ? korpusy.ile : 0;
      const K7 = ctx.ruch.K7;
      for (let i = 0; i < 4; i++) {
        const w = K7[i];
        const t = w.tFazy;
        let tK = 3;
        let tCz = 9;
        let czB = 1e6;
        let czW = -1;
        let zwC = -1e5;
        let zwOn = 0;
        let czL0 = 1;
        switch (w.faza) {
          case FAZA.YELLOW:
            tK = t; tCz = 0; czB = 4000 * t; czL0 = 0;
            break;
          case FAZA.CLEAR:
            tCz = t; czB = Math.min(20000, 4000 * (3 + t));
            break;
          case FAZA.BOX:
            czB = Math.min(1e6, 20000 + 4000 * t);
            break;
          case FAZA.CLEAR2:
            break;
          default: // MAIN
            tK = Math.max(0, 3 - t);
            tCz = Math.max(0, 0.55 - 2 * t);
            czW = Math.min(1e6, 4000 * (t - 2.5));
            czL0 = 0;
            if (t < 9) { zwC = -7800 + 1500 * t; zwOn = 1; }
            break;
        }
        a7[i].set(tK, tCz, czB, czW);
        b7[i].set(zwC, zwOn, czL0, 0);
      }
      const a = ctx.ruch.atlas;
      const kat = K7[a.K].a * DEG;
      const z = a.xs * Math.cos(kat) + a.ys * Math.sin(kat) - R0;
      uAtlas.value.set(a.K, z + POL_KADLUBA, z - POL_KADLUBA, a.stan === 'lot' || a.stan === 'odliczanie' ? 1 : 0);
    }
  };
}
