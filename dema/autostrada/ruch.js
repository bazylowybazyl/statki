// dema/autostrada/ruch.js
//
// MIKROSYMULACJA AUTOSTRADY (demo): IDM + prosty MOBIL na sieci z siec.js, krok 0,1 s, jeden świat dla wszystkich stylów
// wyglądu. Bez three i DOM (testy w Node). Pojazd żyje na pasie głównym (s na promieniu odniesienia jezdni, rosnące z jazdą)
// albo na ścieżce (rampa, zawrotka, wrota, droga ciężkich — ps wzdłuż polilinii). Odpowiada za prawdę sygnału: nikt nie
// przejeżdża linii stopu na czerwonym; w pudle K-7 kolizje rozstrzyga faza.
//
// Układ jak siec.js: scena, y w górę. Jezdnia 0 = wewnętrzna, CW; 1 = zewnętrzna, CCW. Pas 0 = L1 (przy rozdziale, szybki),
// 1 = L2, 2 = L3 (przy krawędzi).
import { zbudujSiec, punktNaSciezce, hubToWorld, HW, NODE, DEG, SPEED, complexes, R0 } from './siec.js';

const TAU = Math.PI * 2;

/** Klasy ruchu. L — długość do odstępów, W — szerokość do pasm, hull — sprite ruchu (null: własna partia ciągników). */
export const KLASY = Object.freeze({
  ciezarowka: Object.freeze({ id: 'ciezarowka', kod: 0, L: 80, W: 16, s0: 60, T: 0.6, a: 200, b: 250, v0: 800, dom: 2, hull: null }),
  prom: Object.freeze({ id: 'prom', kod: 1, L: 120, W: 64, s0: 80, T: 0.7, a: 220, b: 260, v0: 1000, dom: 2, hull: 'inter_station_shuttle' }),
  policja: Object.freeze({ id: 'policja', kod: 2, L: 180, W: 90, s0: 90, T: 0.6, a: 400, b: 400, v0: 1500, dom: 0, hull: 'police_cutter' }),
  turysta: Object.freeze({ id: 'turysta', kod: 3, L: 240, W: 120, s0: 120, T: 0.9, a: 130, b: 150, v0: 900, dom: 2, hull: 'rescue_ship' }),
  kontenerowiec: Object.freeze({ id: 'kontenerowiec', kod: 4, L: 312, W: 156, s0: 150, T: 0.8, a: 130, b: 160, v0: 1200, dom: 1, hull: 'container_ship' }),
  dalekobiezny: Object.freeze({ id: 'dalekobiezny', kod: 5, L: 540, W: 270, s0: 200, T: 0.9, a: 90, b: 120, v0: 1150, dom: 1, hull: 'long_haul_freighter' }),
  tankowiec: Object.freeze({ id: 'tankowiec', kod: 6, L: 540, W: 268, s0: 200, T: 0.9, a: 90, b: 120, v0: 1150, dom: 1, hull: 'tanker' }),
  ciezki: Object.freeze({ id: 'ciezki', kod: 7, L: 1800, W: 900, s0: 400, T: 1.2, a: 60, b: 90, v0: 600, dom: -1, hull: 'heavy_freighter' }),
  mega: Object.freeze({ id: 'mega', kod: 8, L: 2760, W: 1380, s0: 500, T: 1.4, a: 45, b: 70, v0: 500, dom: -1, hull: 'megafreighter' })
});
export const KLASY_LISTA = Object.freeze(Object.values(KLASY));

/** Docelowe liczby na sieci przy gęstości 1 (ciężkie i mega osobno — na węzeł). */
export const SKLAD = Object.freeze({ ciezarowka: 620, prom: 400, policja: 22, turysta: 44, kontenerowiec: 210, dalekobiezny: 90, tankowiec: 50 });

const PASY_R = Object.freeze([
  Object.freeze([HW.iL1, HW.iL2, HW.iL3]),
  Object.freeze([HW.oL1, HW.oL2, HW.oL3])
]);
const PAS_SZER = Object.freeze([HW.widths.L1, HW.widths.L2, HW.widths.L3]);
const PAS_V = Object.freeze([SPEED.L1, SPEED.L2, SPEED.L3]);
const RREF = Object.freeze([HW.iL2, HW.oL2]);
const OBWOD = Object.freeze([TAU * RREF[0], TAU * RREF[1]]);

/** Historia pozycji pojazdów dla śladów: wiersz = chwila (co DT s), kolumna = slot pojazdu; ślad idzie prawdziwym torem. */
export const HIST = Object.freeze({ SLOTY: 2048, WIERSZE: 32, DT: 0.2 });

/** Faza skrzyżowania K-7 widziana przez obraz: co świeci przed linią stopu. */
export const FAZA = Object.freeze({ MAIN: 0, YELLOW: 1, CLEAR: 2, BOX: 3, CLEAR2: 4 });
export const STAN_SWIATLA = Object.freeze({ ZIELONE: 0, ZOLTE: 1, CZERWONE: 2 });

const sOf = (cw, thetaDeg) => {
  const t = ((thetaDeg % 360) + 360) % 360;
  return cw === 0 ? ((360 - t) % 360) * DEG * RREF[0] : t * DEG * RREF[1];
};
const fwd = (cw, a, b) => { const d = (b - a) % OBWOD[cw]; return d < 0 ? d + OBWOD[cw] : d; };
const thetaOf = (cw, s) => (cw === 0 ? -s / RREF[0] : s / RREF[1]);

function mulberry(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function idm(v, v0, gap, dv, c) {
  const sStar = c.s0 + Math.max(0, v * c.T + v * dv / (2 * Math.sqrt(c.a * c.b)));
  const g = Math.max(gap, 1);
  const inter = (sStar / g) * (sStar / g);
  if (v > v0) return Math.max(-c.b * 1.1, -c.b * (1 - (v0 / v) * (v0 / v)) * 1.1) - c.a * inter;
  const u = Math.max(0, v) / Math.max(1, v0);
  return c.a * (1 - u * u * u * u - inter);
}

/** Przód listy po s malejąco: indeks pierwszego pojazdu o s ≤ podanego. */
function szukajS(lista, s) {
  let a = 0;
  let b = lista.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (lista[m].s > s) a = m + 1; else b = m;
  }
  return a;
}

export function utworzRuch(opcje = {}) {
  const dt = opcje.dt || 0.1;
  const los = mulberry(opcje.ziarno || 7);
  const siec = opcje.siec || zbudujSiec();
  const P = siec.poId;
  const cfg = {
    gestosc: opcje.gestosc ?? 1,
    minGlowna: opcje.minGlowna ?? 55,        // [s] najkrócej zielone dla głównej przy wezwaniach ciężkich
    zolte: 3,
    komfort: 160,
    splot: 14000,
    meter: opcje.meter ?? 1.6,               // [s] dozownik wjazdu
    ciezkieNaWezel: opcje.ciezkieNaWezel ?? 2
  };

  // ---------- Pasy, listy ----------
  const pasy = [[[], [], []], [[], [], []]];
  const duchy = [[[], [], []], [[], [], []]];    // pojazdy w trakcie zmiany pasa: widziane też w pasie, z którego schodzą
  const _lat = { r: 0, nach: 0 };
  const _pkt = { x: 0, y: 0, h: 0, k: 0 };
  const hist = { dane: new Float32Array(HIST.SLOTY * HIST.WIERSZE * 2), wiersz: 0, tWiersza: 0, wersja: 0 };
  const wolneSloty = [];
  for (let i = HIST.SLOTY - 1; i >= 0; i--) wolneSloty.push(i);
  let krokN = 0;
  const pojazdy = [];
  let nextId = 1;
  let t = 0;
  const licznik = Object.create(null);
  const czeka = Object.create(null);
  for (const k of KLASY_LISTA) { licznik[k.id] = 0; czeka[k.id] = 0; }
  const stat = { wjazdy: 0, zjazdy: 0, zmiany: 0, nakladki: 0, przejazdyNaCzerwonym: 0, zmianaTrasy: 0, minOdstep: Infinity };
  for (const p of siec.paths) p.lista = [];

  // ---------- Sygnalizacje K-7 ----------
  const K7 = complexes().map((a, k) => ({
    k, a,
    sStop: [sOf(0, a + NODE.stopX / HW.iL2 / DEG), sOf(1, a - NODE.stopX / HW.oL2 / DEG)],
    sWyjscie: [sOf(0, a - NODE.boxHalf / HW.iL2 / DEG), sOf(1, a + NODE.boxHalf / HW.oL2 / DEG)],
    faza: FAZA.MAIN, tFazy: 0, czekajace: 0, wPudle: 0, wymuszenie: false,
    kolejka: [0, 0], stoi: [0, 0], stan: STAN_SWIATLA.ZIELONE
  }));
  const ustawFaze = (w, f) => { w.faza = f; w.tFazy = 0; };

  function pudloPuste(w) {
    for (let cw = 0; cw < 2; cw++) {
      const a = w.sStop[cw];
      const dl = fwd(cw, a, w.sWyjscie[cw]);
      for (const lista of pasy[cw]) {
        for (let i = 0; i < lista.length; i++) if (fwd(cw, a, lista[i].s) < dl) return false;
      }
    }
    return true;
  }

  function krokSygnalow() {
    for (const w of K7) {
      w.tFazy += dt;
      switch (w.faza) {
        case FAZA.MAIN:
          if (w.wymuszenie || (w.czekajace > 0 && w.tFazy >= cfg.minGlowna)) ustawFaze(w, FAZA.YELLOW);
          break;
        case FAZA.YELLOW:
          if (w.tFazy >= cfg.zolte) ustawFaze(w, FAZA.CLEAR);
          break;
        case FAZA.CLEAR:
          if (w.tFazy >= 11 || (w.tFazy >= 2 && pudloPuste(w))) ustawFaze(w, FAZA.BOX);
          break;
        case FAZA.BOX:
          if (!w.wymuszenie && w.wPudle === 0 && (w.czekajace === 0 || w.tFazy >= 34)) ustawFaze(w, FAZA.CLEAR2);
          break;
        case FAZA.CLEAR2:
          if (w.wymuszenie) ustawFaze(w, FAZA.BOX);
          else if (w.tFazy >= 1.5 && w.wPudle === 0) ustawFaze(w, FAZA.MAIN);
          break;
        default:
          break;
      }
      w.stan = w.faza === FAZA.MAIN ? STAN_SWIATLA.ZIELONE : w.faza === FAZA.YELLOW ? STAN_SWIATLA.ZOLTE : STAN_SWIATLA.CZERWONE;
      w.czekajace = 0;
      w.wPudle = 0;
    }
  }

  // ---------- Węzły jako wjazdy i wyjazdy ----------
  const wyjazdy = [];    // zjazdy z pasa L3: zatoki, tranzyty (jezdnia 0) i wrota (jezdnia 1)
  const wjazdy = [];     // wjazdy na L3
  const zawrotki = [];
  for (const n of siec.nodes) {
    if (n.kind === 'bay' || n.kind === 'transit') {
      const off = P.get(`${n.id}.IN`);
      const on = P.get(`${n.id}.OUT`);
      wyjazdy.push({ id: n.id, rodzaj: n.kind, sciezka: off, cw: 0, s: sOf(0, off.gore) });
      wjazdy.push({ id: n.id, rodzaj: n.kind, sciezka: on, cw: 0, kolejka: [], nastepny: 0, od: on.probki.len - NODE.taperLen - NODE.accelLen * 0.6 });
    } else if (n.kind === 'gateOut') {
      const go = P.get(n.id);
      wyjazdy.push({ id: n.id, rodzaj: 'wrota', sciezka: go, cw: 1, s: sOf(1, go.gore) });
    } else if (n.kind === 'gateIn') {
      const gi = P.get(n.id);
      wjazdy.push({ id: n.id, rodzaj: 'wrota', sciezka: gi, cw: 1, kolejka: [], nastepny: 0, od: gi.probki.len - NODE.taperLen - NODE.accelLen * 0.6 });
    } else if (n.kind === 'uturn') {
      const u = P.get(n.id);
      const z = n.uKind === 'U1' ? 1 : 0;
      zawrotki.push({ id: n.id, sciezka: u, z, na: 1 - z, s: sOf(z, n.diverge), sMerge: sOf(1 - z, n.merge), od: u.probki.len - NODE.taperLen * 0.5 - NODE.pocketAccel * 0.6 });
    }
  }
  const noga = (w) => ({ cw: w.cw, pas: 2, s: w.s, sciezka: w.sciezka, zawrotka: null });
  const nogaU = (u) => ({ cw: u.z, pas: 0, s: u.s, sciezka: u.sciezka, zawrotka: u });

  // Trasa z (cw, s) do wyjazdu: lista nóg — najkrótsza przez ≤ 2 zawrotki.
  function trasa(cw, s, cel) {
    let naj = null;
    let dl = Infinity;
    if (cw === cel.cw) { naj = [noga(cel)]; dl = fwd(cw, s, cel.s); }
    for (const u of zawrotki) {
      if (u.z !== cw) continue;
      const d1 = fwd(cw, s, u.s);
      if (d1 < 6000) continue;
      if (u.na === cel.cw) {
        const d = d1 + 7000 + fwd(cel.cw, u.sMerge, cel.s);
        if (d < dl) { dl = d; naj = [nogaU(u), noga(cel)]; }
      } else {
        for (const v of zawrotki) {
          if (v.z !== u.na || v.na !== cel.cw) continue;
          const d = d1 + 14000 + fwd(u.na, u.sMerge, v.s) + fwd(cel.cw, v.sMerge, cel.s);
          if (d < dl) { dl = d; naj = [nogaU(u), nogaU(v), noga(cel)]; }
        }
      }
    }
    return naj;
  }

  function nowyPojazd(klasa, trasaNogi) {
    const hash = los();
    const v = {
      id: nextId++, k: klasa, kod: klasa.kod, L: klasa.L, s0: klasa.s0, T: klasa.T, a: klasa.a, b: klasa.b,
      v0: klasa.v0 * (0.92 + los() * 0.16),
      tryb: 0, cw: 0, pas: 0, s: 0, ps: 0, pi: 0, sciezka: null, wjazd: null,
      vel: 0, acc: 0, r: 0, d: 0, lat0: 0, latM: 0, lat1: 0, latD0: 0, latDs: 1, offCel: 0, off0: 0, offM: 0, offPs0: 0, offPs: 1, duchDo: 0,
      slot: wolneSloty.length ? wolneSloty.pop() : -1, urodzony: t,
      trasa: trasaNogi, noga: 0, lc: 0, hash, n: 1 + Math.floor(los() * 5),
      alfa: 0, zanika: false, zanikT: 1.2, narodzinyT: 1, hamuje: 0,
      dokT: 0, stan: 0, K: null, psStop: 0,
      x: 0, y: 0, h: 0, kr: 0
    };
    if (klasa === KLASY.ciezarowka) v.L = 28 + v.n * 18;
    pojazdy.push(v);
    licznik[klasa.id]++;
    return v;
  }

  // TOR BOCZNY: promień na pasie jest funkcją PRZEBYTEJ DROGI (krzywa Hermite'a), nie czasu. Dzięki temu pozycja i kurs są gładkie
  // w każdej klatce (bez schodków co krok symulacji), stojący statek nie jedzie bokiem, a nachylenie toru wyznacza kurs kadłuba.
  function torBoczny(v, d) {
    const u = (d - v.latD0) / v.latDs;
    if (u >= 1) { _lat.r = v.lat1; _lat.nach = 0; return; }
    if (u <= 0) { _lat.r = v.lat0; _lat.nach = v.latM / v.latDs; return; }
    const u2 = u * u;
    const u3 = u2 * u;
    _lat.r = (2 * u3 - 3 * u2 + 1) * v.lat0 + (u3 - 2 * u2 + u) * v.latM + (-2 * u3 + 3 * u2) * v.lat1;
    _lat.nach = ((6 * u2 - 6 * u) * v.lat0 + (3 * u2 - 4 * u + 1) * v.latM + (-6 * u2 + 6 * u) * v.lat1) / v.latDs;
  }
  function ustawTor(v, p0, nach0, cel, mnoznik, minDs) {
    const ds = Math.max(minDs, Math.min(9000, Math.abs(cel - p0) * mnoznik));
    v.lat0 = p0;
    v.latM = nach0 * ds;
    v.lat1 = cel;
    v.latD0 = v.d;
    v.latDs = ds;
  }
  const celPasa = (v, cw, pas) => PASY_R[cw][pas] + (cw === 0 ? -v.offCel : v.offCel);

  function usun(v) {
    const i = pojazdy.indexOf(v);
    if (i >= 0) { pojazdy[i] = pojazdy[pojazdy.length - 1]; pojazdy.pop(); }
    licznik[v.k.id]--;
    if (v.slot >= 0) { wolneSloty.push(v.slot); v.slot = -1; }
    if (v.tryb === 0) { const l = pasy[v.cw][v.pas]; const j = l.indexOf(v); if (j >= 0) l.splice(j, 1); } else if (v.tryb === 1 && v.sciezka) { const j = v.sciezka.lista.indexOf(v); if (j >= 0) v.sciezka.lista.splice(j, 1); }
  }

  function wybierzPasmo(v) {
    // Pasmo = stałe odsunięcie w pasie: wąskie strugi zamiast jednej osi; ten sam hash — to samo pasmo.
    const szer = PAS_SZER[v.pas];
    const luz = Math.max(0, szer * 0.5 - v.k.W * 0.5 - 8);
    const n = Math.max(1, Math.floor(luz * 2 / Math.max(24, v.k.W * 0.4)));
    v.offCel = n > 1 ? (Math.floor(v.hash * n) + 0.5) / n * 2 * luz - luz : 0;
  }
  function wstawNaPas(v, cw, pas, s) {
    v.tryb = 0; v.cw = cw; v.pas = pas; v.s = s; v.sciezka = null;
    const lista = pasy[cw][pas];
    lista.splice(szukajS(lista, s), 0, v);
    wybierzPasmo(v);
  }
  function wejdzNaSciezke(v, sc, ps = 0) {
    v.tryb = 1; v.sciezka = sc; v.ps = ps; v.pi = 0;
    sc.lista.push(v);
    let i = sc.lista.length - 1;
    while (i > 0 && sc.lista[i - 1].ps < v.ps) { sc.lista[i] = sc.lista[i - 1]; i--; }
    sc.lista[i] = v;
  }

  // ---------- Wybór źródła i celu ----------
  const pick = (a) => a[Math.floor(los() * a.length)];
  const WJ_Z = wjazdy.filter((w) => w.rodzaj === 'bay');
  const WJ_T = wjazdy.filter((w) => w.rodzaj === 'transit');
  const WJ_D = wjazdy.filter((w) => w.rodzaj === 'wrota');
  const WY_Z = wyjazdy.filter((w) => w.rodzaj === 'bay');
  const WY_T = wyjazdy.filter((w) => w.rodzaj === 'transit');
  const WY_D = wyjazdy.filter((w) => w.rodzaj === 'wrota');

  function zrodloICel(klasa) {
    const r = los();
    switch (klasa.id) {
      case 'ciezarowka':
        if (r < 0.45) return [pick(WJ_Z), pick(WY_T)];
        if (r < 0.7) return [pick(WJ_T), pick(WY_Z)];
        return [pick(WJ_Z), pick(WY_Z)];
      case 'prom':
        return r < 0.5 ? [pick(WJ_T), pick(WY_Z)] : [pick(WJ_Z), pick(WY_T)];
      case 'turysta':
        return [pick(WJ_D), pick(WY_D)];
      default:
        return r < 0.5 ? [pick(WJ_D), pick(WY_Z)] : [pick(WJ_Z), pick(WY_D)];
    }
  }
  // Cel pojazdu już jadącego: turysta tylko wrota (w razie czego przez zawrotkę), reszta — swoja jezdnia.
  function celDla(klasa, cw) {
    return klasa.id === 'turysta' ? pick(WY_D) : pick(wyjazdy.filter((w) => w.cw === cw));
  }

  function dozuj() {
    for (const klasa of KLASY_LISTA) {
      if (klasa.dom < 0 || klasa === KLASY.policja) continue;
      const cel = Math.round((SKLAD[klasa.id] || 0) * cfg.gestosc);
      const wolne = cel - licznik[klasa.id] - czeka[klasa.id];
      for (let i = 0; i < wolne && i < 3; i++) {
        const [wj, wy] = zrodloICel(klasa);
        wj.kolejka.push({ klasa, wy });
        czeka[klasa.id]++;
      }
    }
    for (const wj of wjazdy) {
      if (!wj.kolejka.length || t < wj.nastepny) continue;
      const it = wj.kolejka[0];
      const sc = wj.sciezka;
      const ost = sc.lista[sc.lista.length - 1];
      if (ost && ost.ps - ost.L * 0.5 < it.klasa.L * 0.5 + 180) continue;
      wj.kolejka.shift();
      czeka[it.klasa.id]--;
      const sq = sc.probki;
      const koniec = sq.n - 1;
      const thetaKonca = Math.atan2(sq.y[koniec], sq.x[koniec]) / DEG;
      const nogi = trasa(wj.cw, sOf(wj.cw, thetaKonca), it.wy);
      if (!nogi) continue;
      const v = nowyPojazd(it.klasa, nogi);
      v.cw = wj.cw;
      v.vel = Math.min(sc.kind === 'gateIn' ? 900 : 260, sq.vp[0]);
      v.wjazd = wj;
      v.narodzinyT = sc.kind === 'gateIn' ? 0.6 : 1.2;
      wejdzNaSciezke(v, sc, 0);
      wj.nastepny = t + cfg.meter;
      stat.wjazdy++;
    }
  }

  // ---------- Rozruch: pełna droga od pierwszej klatki ----------
  function rozruch() {
    for (const klasa of KLASY_LISTA) {
      if (klasa.dom < 0) continue;
      const ile = Math.round((SKLAD[klasa.id] || 0) * cfg.gestosc * (klasa === KLASY.policja ? 1 : 0.85));
      for (let i = 0; i < ile; i++) {
        const cw = i % 2 === 0 ? 0 : 1;
        const pas = klasa.dom;
        const s = los() * OBWOD[cw];
        const lista = pasy[cw][pas];
        const j = szukajS(lista, s);
        const a = lista.length ? (lista[j - 1] || lista[lista.length - 1]) : null;
        const b = lista.length ? (lista[j] || lista[0]) : null;
        const dystans = klasa.L + klasa.s0 * 2 + 120;
        if ((a && fwd(cw, s, a.s) < dystans) || (b && fwd(cw, b.s, s) < dystans)) continue;
        const cel = klasa === KLASY.policja ? null : celDla(klasa, cw);
        const nogi = cel ? trasa(cw, s, cel) : null;
        const v = nowyPojazd(klasa, nogi);
        v.vel = Math.min(PAS_V[pas], v.v0) * 0.92;
        v.alfa = 1;
        wstawNaPas(v, cw, pas, s);
        const celR = celPasa(v, cw, pas);
        v.lat0 = celR; v.lat1 = celR; v.latM = 0; v.latDs = 1; v.latD0 = v.d - 2;
      }
    }
  }

  // ---------- Ciężkie i mega: tylko przez pudła K-7 ----------
  const ciezkie = siec.paths.filter((p) => p.kind === 'heavy');
  const _psLinii = new Map();
  const _psPudla = new Map();
  // Linia oczekiwania: przed krawędzią jezdni, zależnie od kierunku.
  function psLinii(sc) {
    let w = _psLinii.get(sc);
    if (w !== undefined) return w;
    const q = sc.probki;
    const rGranica = sc.dir === 'in' ? HW.edgeOut + 1700 : HW.edgeIn - 1400;
    w = 0;
    for (let i = 0; i < q.n; i++) {
      const r = Math.hypot(q.x[i], q.y[i]);
      if (sc.dir === 'in' ? r <= rGranica : r >= rGranica) { w = q.s[i]; break; }
    }
    _psLinii.set(sc, w);
    return w;
  }
  // Koniec pudła wzdłuż ścieżki: chwila, gdy środek minął drugą krawędź jezdni.
  function psKoncaPudla(sc) {
    let w = _psPudla.get(sc);
    if (w !== undefined) return w;
    const q = sc.probki;
    const rGranica = sc.dir === 'in' ? HW.edgeIn - 100 : HW.edgeOut + 100;
    w = q.len;
    for (let i = 0; i < q.n; i++) {
      const r = Math.hypot(q.x[i], q.y[i]);
      if (sc.dir === 'in' ? r <= rGranica : r >= rGranica) { w = q.s[i]; break; }
    }
    _psPudla.set(sc, w);
    return w;
  }
  function dozujCiezkie() {
    if (cfg.ciezkieNaWezel <= 0) return;
    if (licznik.ciezki + licznik.mega >= cfg.ciezkieNaWezel * K7.length) return;
    if (los() > dt * 0.25) return;
    const sc = pick(ciezkie);
    if (sc.lista.length) return;
    const klasa = los() < 0.75 ? KLASY.ciezki : KLASY.mega;
    const v = nowyPojazd(klasa, null);
    v.vel = sc.dir === 'in' ? klasa.v0 : 0;
    v.narodzinyT = 3;
    v.K = K7[Number(sc.id[1])];
    wejdzNaSciezke(v, sc, 0);
    v.stan = 0;   // 0 — dojazd do linii oczekiwania; 1 — przejazd przez pudło; 2 — po przejeździe
    v.psStop = psLinii(sc);
  }

  // ---------- Atlas (misja 1: wylot z K-7 przez G-01) ----------
  const atlas = {
    stan: 'dok', czas: 0, K: 0, x: NODE.boxLanes[1], z: 3600, v: 0, vmax: 507, a: 160, opoznienie: 3.45,
    xs: 0, ys: 0, kat: 0, widoczny: true, licznikStartow: 0, zwolnionoT: -1
  };
  function atlasStart(o = {}) {
    if (atlas.stan !== 'dok') return false;
    atlas.stan = 'odliczanie';
    atlas.czas = 0;
    atlas.licznikStartow++;
    atlas.K = o.k ?? 3;      // K-7 nr 0 z gry leży na 315° sceny, indeks 3 w complexes()
    atlas.vmax = o.dopalacz ? 1137 : 507;
    K7[atlas.K].wymuszenie = true;
    return true;
  }
  function krokAtlasa() {
    atlas.czas += dt;
    const w = K7[atlas.K];
    if (atlas.stan === 'odliczanie') {
      if (atlas.czas >= atlas.opoznienie) { atlas.stan = 'lot'; atlas.czas = 0; }
    } else if (atlas.stan === 'lot') {
      atlas.v = Math.min(atlas.vmax, atlas.v + atlas.a * dt);
      atlas.z += atlas.v * dt;
      if (w.wymuszenie && R0 + atlas.z - 900 > HW.edgeOut + 200) { w.wymuszenie = false; atlas.zwolnionoT = t; }
      if (atlas.z > 30000) { atlas.stan = 'poza'; atlas.czas = 0; atlas.widoczny = false; }
    } else if (atlas.stan === 'poza') {
      if (atlas.czas > 3) { atlas.stan = 'dok'; atlas.z = 3600; atlas.v = 0; atlas.widoczny = true; }
    }
  }

  // ---------- Krok ----------
  function przeszkodaSygnalu(v) {
    let naj = Infinity;
    const przod = v.s + v.L * 0.5;
    for (const w of K7) {
      if (w.stan === STAN_SWIATLA.ZIELONE) continue;
      const d = fwd(v.cw, przod, w.sStop[v.cw]);
      if (d > 14000) continue;
      if (w.stan === STAN_SWIATLA.ZOLTE && d < v.vel * v.vel / (2 * cfg.komfort)) continue;
      if (d < naj) naj = d;
    }
    return naj;
  }

  function przyspieszenieGlowne(v, lista, i) {
    let vCel = Math.min(PAS_V[v.pas], v.v0);
    const n = v.trasa ? v.trasa[v.noga] : null;
    let ogon = null;
    if (n) {
      const dx = fwd(v.cw, v.s, n.s);
      if (dx < cfg.splot) {
        if (v.pas !== n.pas) vCel = Math.min(vCel, dx < 1200 ? 150 : dx < 2500 ? 400 : dx < 6000 ? 650 : 950);
        if (n.zawrotka && dx < 3500) vCel = Math.min(vCel, 800);
        if (dx < 6000 && n.sciezka.lista.length) ogon = n.sciezka.lista[n.sciezka.lista.length - 1];
      }
    }
    const lead = i > 0 ? lista[i - 1] : (lista.length > 1 ? lista[lista.length - 1] : null);
    let acc;
    if (lead) {
      const dist = fwd(v.cw, v.s, lead.s);
      const gap = dist - lead.L * 0.5 - v.L * 0.5;
      if (gap < stat.minOdstep) stat.minOdstep = gap;
      if (gap < 0) stat.nakladki++;
      acc = idm(v.vel, vCel, gap, v.vel - lead.vel, v);
    } else acc = idm(v.vel, vCel, 1e9, 0, v);
    if (ogon && v.pas === n.pas) {
      // Hamowanie na ogon rampy: odległość do wejścia + ps ogona, jeśli ten stoi blisko początku.
      const d = fwd(v.cw, v.s, n.s) + ogon.ps - ogon.L * 0.5 - v.L * 0.5;
      if (d < 3000) acc = Math.min(acc, idm(v.vel, vCel, d, v.vel - ogon.vel, v));
    }
    const dStop = przeszkodaSygnalu(v);
    if (dStop < Infinity) acc = Math.min(acc, idm(v.vel, vCel, Math.max(dStop, 1), v.vel, v));
    const d_ = duchy[v.cw][v.pas];
    for (let j = 0; j < d_.length; j++) {
      const g = d_[j];
      if (g === v) continue;
      const dist = fwd(v.cw, v.s, g.s);
      if (dist < 2500) acc = Math.min(acc, idm(v.vel, vCel, dist - g.L * 0.5 - v.L * 0.5, v.vel - g.vel, v));
    }
    return Math.max(acc, -v.b * 2.5);
  }

  function przyspieszenieNaSciezce(v, lista, i) {
    const q = v.sciezka.probki;
    const iS = Math.min(q.n - 1, Math.max(0, Math.round(v.ps / q.len * (q.n - 1))));
    const vCel = v.k.dom < 0 ? Math.min(q.vp[iS], v.v0) : q.vp[iS];
    const lead = i > 0 ? lista[i - 1] : null;
    let acc = lead
      ? idm(v.vel, vCel, lead.ps - v.ps - lead.L * 0.5 - v.L * 0.5, v.vel - lead.vel, v)
      : idm(v.vel, vCel, 1e9, 0, v);
    // Ściana tylko na końcu ścieżek z wtopieniem; zjazdy i drogi ciężkich hamuje profil vp (koniec ścieżki = zanik / stanowisko).
    const k = v.sciezka.kind;
    if (k === 'rampOn' || k === 'gateIn' || k === 'uturn') {
      const koniec = q.len - v.ps - v.L * 0.5;
      acc = Math.min(acc, idm(v.vel, vCel, Math.max(koniec, 1), v.vel, v));
    }
    if (v.k.dom < 0 && v.stan === 0) {
      // Ciężki przed linią oczekiwania: wezwanie i przepuszczenie przez fazę K-7.
      const w = v.K;
      const d = v.psStop - v.ps - v.L * 0.5;
      if (d < 4000) w.czekajace++;
      const pozwolono = (w.faza === FAZA.CLEAR && w.tFazy >= 4) || (w.faza === FAZA.BOX && w.tFazy <= 22);
      if (pozwolono && d < 1500) v.stan = 1;
      else if (d >= -50) acc = Math.min(acc, idm(v.vel, vCel, Math.max(d, 1), v.vel, v));
    }
    if (v.k.dom < 0 && v.stan === 1) {
      v.K.wPudle++;
      if (v.ps - v.L * 0.5 > psKoncaPudla(v.sciezka)) v.stan = 2;
    }
    return Math.max(acc, -v.b * 2.5);
  }

  function sasiedzi(cw, lista, s, out) {
    out.przed = null; out.za = null; out.dPrzed = Infinity; out.dZa = Infinity;
    if (!lista.length) return;
    const j = szukajS(lista, s);
    const a = j > 0 ? lista[j - 1] : lista[lista.length - 1];
    const b = j < lista.length ? lista[j] : lista[0];
    out.przed = a; out.dPrzed = fwd(cw, s, a.s);
    out.za = b; out.dZa = fwd(cw, b.s, s);
  }
  const _sas = { przed: null, za: null, dPrzed: 0, dZa: 0 };

  function miesciSie(v, cw, lista, s, luz) {
    sasiedzi(cw, lista, s, _sas);
    if (_sas.przed && _sas.przed !== v) {
      const gap = _sas.dPrzed - _sas.przed.L * 0.5 - v.L * 0.5;
      if (gap < (v.s0 * 0.6 + Math.max(0, v.vel - _sas.przed.vel) * 1.2 + v.vel * 0.25) * luz) return false;
    }
    if (_sas.za && _sas.za !== v) {
      const gap = _sas.dZa - _sas.za.L * 0.5 - v.L * 0.5;
      if (gap < (_sas.za.s0 * 0.6 + Math.max(0, _sas.za.vel - v.vel) * 1.4 + _sas.za.vel * 0.3) * luz) return false;
    }
    return true;
  }

  function zmienPas(v, lista, i, nast, wymuszone) {
    const cel = pasy[v.cw][nast];
    if (!miesciSie(v, v.cw, cel, v.s, wymuszone ? 0.6 : 1)) return false;
    lista.splice(i, 1);
    // Duch w starym pasie: dopóki kadłub fizycznie stoi na granicy, jadący za nim w starym pasie też go widzi.
    torBoczny(v, v.d);
    const p0 = _lat.r;
    const n0 = _lat.nach;
    v.duchDo = 0;
    duchy[v.cw][v.pas].push(v);
    v.pas = nast;
    cel.splice(szukajS(cel, v.s), 0, v);
    wybierzPasmo(v);
    ustawTor(v, p0, n0, celPasa(v, v.cw, nast), wymuszone ? 7 : 11, wymuszone ? 1000 : 1800);
    v.duchDo = v.d + v.latDs * 0.6;
    v.lc = t + (wymuszone ? 1.5 : 8 + los() * 8);
    stat.zmiany++;
    return true;
  }

  function zawrotkaPatrolu(v, cw) {
    let naj = null;
    let d = Infinity;
    for (const z of zawrotki) {
      if (z.z !== cw) continue;
      const q = fwd(cw, v.s, z.s);
      if (q > 8000 && q < d) { d = q; naj = z; }
    }
    if (naj) { v.trasa = [nogaU(naj)]; v.noga = 0; }
  }

  function decyzjeNaPasie(v, cw, pas, lista, i) {
    // Patrol policji: co jakiś czas zawrotka, żeby widać ją było na obu jezdniach.
    if (!v.trasa && v.k === KLASY.policja && los() < dt * 0.012) zawrotkaPatrolu(v, cw);
    const n = v.trasa ? v.trasa[v.noga] : null;
    if (n) {
      const d = fwd(cw, v.s, n.s);
      const minal = d > OBWOD[cw] * 0.9;
      if (pas === n.pas && minal) {
        lista.splice(i, 1);
        v.wjazd = n.zawrotka;
        const ps = OBWOD[cw] - d;
        const sc = n.sciezka;
        // Bez skoku: reszta odsunięcia wobec osi ścieżki gaśnie po drodze (po prawej burcie, znak jak na pasie).
        torBoczny(v, v.d);
        punktNaSciezce(sc.probki, ps, _pkt, 0);
        const rS = Math.sqrt(_pkt.x * _pkt.x + _pkt.y * _pkt.y);
        v.off0 = cw === 0 ? rS - _lat.r : _lat.r - rS;
        v.offPs0 = ps;
        v.offPs = ps + Math.max(1500, Math.abs(v.off0) * 12);
        // Nachylenie toru z pasa przechodzi na odsunięcie (kurs bez skoku przy zjeździe w trakcie zmiany pasa).
        v.offM = (cw === 0 ? -_lat.nach : _lat.nach) * (v.offPs - v.offPs0);
        wejdzNaSciezke(v, sc, ps);
        v.noga++;
        stat.zjazdy++;
        return;
      }
      if (d < 90 || minal) {
        if (pas === n.pas) return;
        // Nie zdążył na pas: następny zjazd na tej jezdni (w demie nikt nie znika).
        stat.zmianaTrasy++;
        if (v.k === KLASY.policja) { v.trasa = null; return; }
        v.trasa = trasa(cw, v.s, celDla(v.k, cw));
        v.noga = 0;
        return;
      }
    }
    if (t < v.lc) return;
    const dNogi = n ? fwd(cw, v.s, n.s) : Infinity;
    const chce = dNogi < cfg.splot ? n.pas : v.k.dom;
    if (chce !== pas) {
      zmienPas(v, lista, i, chce > pas ? pas + 1 : pas - 1, dNogi < 9000);
      return;
    }
    const lead = i > 0 ? lista[i - 1] : null;
    if (lead && pas > 0 && lead.vel < v.v0 * 0.8 && fwd(cw, v.s, lead.s) < v.vel * 2.5 + 400 && dNogi > cfg.splot + 5000) {
      zmienPas(v, lista, i, pas - 1, false);
    } else if (pas < v.k.dom && dNogi > cfg.splot && los() < dt * 0.1) {
      zmienPas(v, lista, i, pas + 1, false);
    }
  }

  function krokSciezki(v, sc, lista, i) {
    const q = sc.probki;
    const koniec = q.len;
    if (v.k.dom < 0) {
      if (v.ps >= koniec - v.L * 0.5 - 40) {
        if (sc.dir === 'in') {
          // Stanowisko w zatoce: postój, potem kadłub gaśnie (w grze: cumowanie, tu nie ma kursów dalej).
          v.tryb = 2; v.vel = 0; v.acc = 0; v.dokT = 25 + los() * 30;
          lista.splice(i, 1);
        } else if (!v.zanika) { v.zanika = true; v.zanikT = 2.5; }
      }
      return;
    }
    if (sc.kind === 'rampOn' || sc.kind === 'gateIn' || sc.kind === 'uturn') {
      const od = v.wjazd?.od ?? (koniec - NODE.taperLen - NODE.accelLen * 0.6);
      if (v.ps >= od) {
        v.pi = punktNaSciezce(q, v.ps, _pkt, v.pi);
        const thR = Math.atan2(_pkt.y, _pkt.x);
        const cw = sc.kind === 'uturn' ? (sc.uKind === 'U1' ? 0 : 1) : (sc.kind === 'gateIn' ? 1 : 0);
        const pas = sc.kind === 'uturn' ? 0 : 2;
        const s = sOf(cw, thR / DEG);
        const luz = v.ps > koniec - 500 ? 0.45 : 0.85;
        if (miesciSie(v, cw, pasy[cw][pas], s, luz)) {
          lista.splice(i, 1);
          // Ciągłość: promień i nachylenie z pozy na ścieżce (kurs kadłuba bez skoku).
          const rS = Math.sqrt(_pkt.x * _pkt.x + _pkt.y * _pkt.y);
          const rObecny = rS + (cw === 0 ? -1 : 1) * odsuniecieSciezki(v);
          let alfa = _pkt.h - (thR + (cw === 0 ? -1 : 1) * Math.PI * 0.5);
          alfa = Math.atan2(Math.sin(alfa), Math.cos(alfa));
          const nach = Math.max(-0.5, Math.min(0.5, (cw === 0 ? 1 : -1) * Math.tan(alfa)));
          wstawNaPas(v, cw, pas, s);
          ustawTor(v, rObecny, nach, celPasa(v, cw, pas), 9, 1500);
          v.lc = t + 2;
          if (v.k === KLASY.policja) { v.trasa = null; v.noga = 0; }
        }
      }
      return;
    }
    // Zjazdy: koniec ścieżki = wejście do zatoki, tunelu albo skok w kosmos.
    if (v.ps >= koniec - v.L * 0.5 - 30 && !v.zanika) {
      v.zanika = true;
      v.zanikT = sc.kind === 'gateOut' ? 0.5 : 1.0;
    }
  }

  function policzKolejki() {
    for (const w of K7) {
      for (let cw = 0; cw < 2; cw++) {
        let ogon = 0;
        let stoi = 0;
        const stop = w.sStop[cw];
        for (let l = 0; l < 3; l++) {
          const lista = pasy[cw][l];
          for (let i = 0; i < lista.length; i++) {
            const v = lista[i];
            if (v.vel > 40) continue;
            const d = fwd(cw, v.s, stop);
            if (d < 14000) { stoi++; if (d > ogon) ogon = d; }
          }
        }
        w.kolejka[cw] = ogon;
        w.stoi[cw] = stoi;
      }
    }
  }

  function step() {
    dozuj();
    dozujCiezkie();
    krokAtlasa();
    for (let cw = 0; cw < 2; cw++) {
      for (let l = 0; l < 3; l++) {
        const lista = pasy[cw][l];
        for (let i = 0; i < lista.length; i++) lista[i].acc = przyspieszenieGlowne(lista[i], lista, i);
      }
    }
    for (const sc of siec.paths) {
      const lista = sc.lista;
      for (let i = 0; i < lista.length; i++) lista[i].acc = przyspieszenieNaSciezce(lista[i], lista, i);
    }
    krokSygnalow();
    for (let i = 0; i < pojazdy.length; i++) {
      const v = pojazdy[i];
      if (v.tryb === 2) {
        v.dokT -= dt;
        if (v.dokT <= 0 && !v.zanika) { v.zanika = true; v.zanikT = 3; }
        if (v.zanika) v.alfa -= dt / v.zanikT; else if (v.alfa < 1) v.alfa = Math.min(1, v.alfa + dt / v.narodzinyT);
        continue;
      }
      const stary = v.vel;
      v.vel = Math.max(0, v.vel + v.acc * dt);
      const ds = (stary + v.vel) * 0.5 * dt;
      v.hamuje = v.acc < -30 || v.vel < 25 ? 1 : 0;
      if (v.tryb === 0) {
        const s0 = v.s;
        v.s = (v.s + ds) % OBWOD[v.cw];
        // Strażnik prawdy sygnału: nos przez linię stopu przy czerwonym (po 1,5 s od zapalenia).
        for (const w of K7) {
          if (w.stan !== STAN_SWIATLA.CZERWONE || w.tFazy < 1.5) continue;
          const a = fwd(v.cw, s0 + v.L * 0.5, w.sStop[v.cw]);
          if (a < ds) stat.przejazdyNaCzerwonym++;
        }
      } else v.ps += ds;
      v.d += ds;
      if (v.zanika) v.alfa -= dt / v.zanikT; else if (v.alfa < 1) v.alfa = Math.min(1, v.alfa + dt / v.narodzinyT);
    }
    // Duchy: koniec, gdy kadłub minął granicę pasa albo zjechał z pasa.
    for (let cw = 0; cw < 2; cw++) {
      for (let l = 0; l < 3; l++) {
        const d_ = duchy[cw][l];
        for (let j = d_.length - 1; j >= 0; j--) {
          const g = d_[j];
          if (g.tryb !== 0 || g.cw !== cw || g.d >= g.duchDo || g.zanika) { d_[j] = d_[d_.length - 1]; d_.pop(); }
        }
      }
    }
    for (let cw = 0; cw < 2; cw++) {
      for (let l = 0; l < 3; l++) {
        const lista = pasy[cw][l];
        for (let i = 1; i < lista.length; i++) {
          const x = lista[i];
          let j = i - 1;
          while (j >= 0 && lista[j].s < x.s) { lista[j + 1] = lista[j]; j--; }
          lista[j + 1] = x;
        }
        for (let i = lista.length - 1; i >= 0; i--) decyzjeNaPasie(lista[i], cw, l, lista, i);
      }
    }
    for (const sc of siec.paths) {
      const lista = sc.lista;
      for (let i = lista.length - 1; i >= 0; i--) krokSciezki(lista[i], sc, lista, i);
    }
    for (let i = pojazdy.length - 1; i >= 0; i--) {
      const v = pojazdy[i];
      if (v.zanika && v.alfa <= 0) usun(v);
    }
    policzKolejki();
    t += dt;
    if (++krokN % 2 === 0) zapiszWiersz();
  }

  // Historia: raz na HIST.DT poza każdego pojazdu trafia do swojego slotu w nowym wierszu (ślady nie zgadują toru z krzywizny).
  function zapiszWiersz() {
    hist.wiersz = (hist.wiersz + 1) % HIST.WIERSZE;
    const start = hist.wiersz * HIST.SLOTY * 2;
    const dane = hist.dane;
    for (let i = 0; i < pojazdy.length; i++) {
      const v = pojazdy[i];
      if (v.slot < 0) continue;
      wpiszPoze(v, 0);
      dane[start + v.slot * 2] = v.x;
      dane[start + v.slot * 2 + 1] = v.y;
    }
    hist.tWiersza = t;
    hist.wersja++;
  }

  // ---------- Pozy w chwili klatki ----------
  // Odsunięcie od osi ścieżki po prawej burcie: gaśnie z drogą (S5), z pochodną do kursu.
  // Hermite (p0 = off0, m0 = offM, p1 = 0, m1 = 0) po drodze wzdłuż ścieżki; `_off.d` — pochodna po ps.
  const _off = { o: 0, d: 0 };
  function odsuniecieSciezki(v, ps = v.ps) {
    if (v.off0 === 0 && v.offM === 0) { _off.o = 0; _off.d = 0; return 0; }
    const L = v.offPs - v.offPs0;
    const u = Math.max(0, Math.min(1, (ps - v.offPs0) / L));
    const u2 = u * u;
    const u3 = u2 * u;
    _off.o = (2 * u3 - 3 * u2 + 1) * v.off0 + (u3 - 2 * u2 + u) * v.offM;
    _off.d = u >= 1 ? 0 : ((6 * u2 - 6 * u) * v.off0 + (3 * u2 - 4 * u + 1) * v.offM) / L;
    return _off.o;
  }
  function wpiszPoze(v, tau) {
    const ds = (v.vel + 0.5 * v.acc * tau) * tau;
    if (v.tryb === 0) {
      const s = v.s + ds;
      const th = thetaOf(v.cw, s);
      torBoczny(v, v.d + ds);
      const rr = _lat.r;
      v.r = rr;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      v.x = rr * c;
      v.y = rr * sn;
      const kier = v.cw === 0 ? -1 : 1;
      // Na zewnątrz po lewej burcie przy jeździe CW, po prawej przy CCW: kurs wg nachylenia toru (dawniej: znak odwrotny).
      const odch = _lat.nach === 0 ? 0 : Math.atan(_lat.nach);
      v.h = th + kier * Math.PI * 0.5 + (v.cw === 0 ? odch : -odch);
      v.kr = kier / rr;
    } else {
      const q = v.sciezka.probki;
      const ps = Math.min(q.len, v.ps + ds);
      v.pi = punktNaSciezce(q, ps, _pkt, v.pi);
      v.x = _pkt.x;
      v.y = _pkt.y;
      v.h = _pkt.h;
      const n = Math.min(q.n - 1, v.pi + 2);
      let dh = q.h[n] - q.h[v.pi];
      if (dh > Math.PI) dh -= TAU; else if (dh < -Math.PI) dh += TAU;
      v.kr = Math.sign(dh) * _pkt.k;
      if (v.off0 !== 0 || v.offM !== 0) {
        const off = odsuniecieSciezki(v, ps);
        if (off !== 0 || _off.d !== 0) {
          const snH = Math.sin(v.h);
          const csH = Math.cos(v.h);
          v.x += snH * off;
          v.y -= csH * off;
          // Odsunięcie po prawej burcie rośnie → kurs skręca w prawo.
          v.h -= Math.atan(_off.d);
        }
      }
    }
  }
  function odswiezPozy(tau = 0) {
    for (let i = 0; i < pojazdy.length; i++) {
      const v = pojazdy[i];
      wpiszPoze(v, v.tryb === 2 ? 0 : tau);
    }
    const z = atlas.z + (atlas.stan === 'lot' ? atlas.v * tau : 0);
    const a = K7[atlas.K].a;
    const p = hubToWorld(a, atlas.x, z);
    atlas.xs = p.x;
    atlas.ys = p.y;
    atlas.kat = a * DEG;
  }

  return {
    siec, cfg, K7, pasy, pojazdy, licznik, stat, atlas, wyjazdy, wjazdy, zawrotki, dt, hist,
    get czas() { return t; },
    step, rozruch, odswiezPozy, atlasStart, ustawFaze,
    OBWOD, sOf, fwd, thetaOf, PASY_R
  };
}
