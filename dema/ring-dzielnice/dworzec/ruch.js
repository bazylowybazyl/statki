// DWORZEC PROMÓW — RUCH (czysta symulacja, bez three i DOM; test: tests/ringDzielnicaDworzec.test.mjs).
//
// Każde stanowisko dworca ma własny cykl: PUSTE (czeka na przylot) → PRZYLOT drogą (pas, skręt na plac, oś doku,
// dojazd dziobem do rękawa) → POSTÓJ ~60 s (wymiana pasażerów) → ODLOT (wycofanie rufą na plac, obrót w miejscu,
// wyjazd na drogę) → PUSTE. Ruch prawostronny; trasy z `berthRoutes` (uklad.js).
// Promy nie wjeżdżają w siebie: każdy przelot jest funkcją czasu, więc przed startem sprawdza się go z przelotami
// już trwającymi (odstęp środków ≥ pół sumy długości + zapas); gdy koliduje — start czeka i próbuje za chwilę.
import { DW, FERRY_HULL, berthRoutes } from './uklad.js';

/** Nastawy ruchu (j./s, s). Postój wg ekonomii: promy stoją 60 s. */
export const FERRY = Object.freeze({
  dock: 60,              // postój na stanowisku [s]
  road: 330,             // prędkość na drodze
  court: 125,            // na placu dworcowym
  creep: 28,             // przy rękawie
  back: 46,              // wycofanie rufą
  turnRate: 0.62,        // obrót w miejscu [rad/s]
  decel: 20,             // hamowanie do stanowiska [j./s²]
  accel: 34,             // rozpędzanie przy odlocie
  gapMin: 14,            // pusta przerwa między odlotem a następnym przylotem [s]
  gapMax: 58,
  retry: 1.6,            // po ilu sekundach ponowić start wstrzymany przez inny prom
  clear: 150             // zapas odstępu między promami [j.]
});

const HULL_LEN = Object.freeze({ s: 120, m: 312, l: 540 });   // długości obrazu kadłubów promów (trafficHullRenderSize)
const HULL_WID = Object.freeze({ s: 64, m: 156, l: 270 });
export const ferrySize = (cls) => ({ length: HULL_LEN[cls], width: HULL_WID[cls] });

/** Tablica czas ↔ droga dla trasy z profilem prędkości `speedAt(d)`; `timeAt(d)`, `distAt(t)`, `total`. */
function profile(len, speedAt, step = 16) {
  const n = Math.max(1, Math.ceil(len / step));
  const ds = len / n;
  const t = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) t[i] = t[i - 1] + ds / Math.max(4, speedAt((i - 0.5) * ds));
  const total = t[n];
  function distAt(time) {
    if (time <= 0) return 0;
    if (time >= total) return len;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (t[mid] <= time) lo = mid; else hi = mid;
    }
    return (lo + (time - t[lo]) / Math.max(1e-9, t[hi] - t[lo])) * ds;
  }
  return { total, distAt, speedAt };
}

const wrapPi = (a) => { let x = a % (Math.PI * 2); if (x > Math.PI) x -= Math.PI * 2; if (x < -Math.PI) x += Math.PI * 2; return x; };

/** Przylot: trasa `route` (próbnik z `gate`) do środka pola. */
function arrivalTrip(route) {
  const L = route.len;
  const speedAt = (d) => {
    let v = d < route.gate - 420 ? FERRY.road : d < route.gate ? FERRY.road + (FERRY.court - FERRY.road) * ((d - route.gate + 420) / 420) : FERRY.court;
    v = Math.min(v, Math.sqrt(FERRY.creep * FERRY.creep + 2 * FERRY.decel * Math.max(0, L - d)));
    return v;
  };
  const P = profile(L, speedAt);
  return {
    kind: 'in', dur: P.total, gateT: 0,
    pose(tau, out) {
      const d = P.distAt(tau);
      route.at(d, out);
      out.speed = tau >= P.total ? 0 : speedAt(d);
      out.rev = 0;
      out.fade = Math.min(1, d / 1400);
      out.d = d;
      return out;
    }
  };
}

/** Odlot: wycofanie rufą (`back`), obrót w miejscu, wyjazd trasą `route`. */
function departureTrip(routes, route) {
  const back = routes.back;
  const tBack = back.len / FERRY.back + 1.2;               // łagodny start i koniec
  const h0 = routes.heading;
  const o = {};
  route.at(0, o);
  const dh = wrapPi(o.h - h0);
  const tTurn = Math.abs(dh) / FERRY.turnRate + 0.6;
  const L = route.len;
  const speedAt = (d) => {
    const v = Math.sqrt(30 * 30 + 2 * FERRY.accel * d);
    return Math.min(v, d < route.gate ? FERRY.court * 1.15 : FERRY.road);
  };
  const P = profile(L, speedAt);
  const ease = (u) => u * u * (3 - 2 * u);
  return {
    kind: 'out', dur: tBack + tTurn + P.total, clearT: tBack,
    pose(tau, out) {
      if (tau < tBack) {
        back.at(back.len * ease(Math.max(0, tau / tBack)), out);
        out.h = h0;
        out.speed = FERRY.back;
        out.rev = 1;
        out.fade = 1;
        return out;
      }
      if (tau < tBack + tTurn) {
        back.at(back.len, out);
        out.h = h0 + dh * ease((tau - tBack) / tTurn);
        out.speed = 0;
        out.rev = 0;
        out.fade = 1;
        return out;
      }
      const d = P.distAt(tau - tBack - tTurn);
      route.at(d, out);
      out.speed = speedAt(d);
      out.rev = 0;
      out.fade = Math.min(1, (L - d) / 1400);
      return out;
    }
  };
}

/** Deterministyczny generator (ten sam ruch przy każdym otwarciu i w teście). */
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * Symulacja dworca. `occupied` — zbiór id zajętych stanowisk gospodarza (lampy stanu: czerwona = zajęte albo
 * zarezerwowane dla promu w drodze). Zwraca { slots, step(dt), each(fn), stats, time }.
 */
export function createFerryTraffic(layout, { occupied = new Set(), seed = 20261113 } = {}) {
  const rnd = lcg(seed);
  const slots = layout.terminalBerths.map((berth, i) => {
    const routes = berthRoutes(layout, berth);
    return {
      index: i, berth, routes, cls: berth.cls, hull: FERRY_HULL[berth.cls], size: ferrySize(berth.cls),
      trips: Object.fromEntries(routes.used.map((key) => [key, key.startsWith('in') ? arrivalTrip(routes[key]) : departureTrip(routes, routes[key])])),
      phase: 'empty', wait: 0, t0: 0, trip: null, n: 0, lamp: 0
    };
  });
  const sim = { time: 0, arrivals: 0, departures: 0, held: 0 };
  const A = {};
  const B = {};

  // stan początkowy: część promów już stoi przy rękawach (różny czas do odlotu), reszta stanowisk czeka na przylot
  slots.forEach((sl) => {
    if (rnd() < 0.5) {
      sl.phase = 'dock';
      sl.wait = 6 + rnd() * FERRY.dock;
      occupied.add(sl.berth.id);
    } else {
      sl.phase = 'empty';
      sl.wait = 2 + rnd() * 46;
    }
  });

  /** Czy przelot `trip` stanowiska `sl` startujący teraz mija z odstępem wszystkie trwające przeloty. */
  function free(sl, trip) {
    for (const o of slots) {
      if (o === sl || !o.trip) continue;
      const need = (sl.size.length + o.size.length) / 2 + FERRY.clear;
      const off = sim.time - o.t0;
      const end = Math.min(trip.dur, o.trip.dur - off);
      for (let tau = 0; tau <= end; tau += 0.8) {
        trip.pose(tau, A);
        o.trip.pose(tau + off, B);
        const dx = A.x - B.x;
        const dz = A.z - B.z;
        if (dx * dx + dz * dz < need * need) return false;
      }
    }
    return true;
  }

  function start(sl, key) {
    const trip = sl.trips[key];
    if (!free(sl, trip)) { sl.wait = FERRY.retry; sim.held++; return false; }
    sl.trip = trip;
    sl.t0 = sim.time;
    sl.key = key;
    return true;
  }

  function step(dt) {
    sim.time += dt;
    for (const sl of slots) {
      if (sl.phase === 'empty') {
        sl.wait -= dt;
        if (sl.wait <= 0) {
          // hala: przyloty na zmianę z obu stron
          const key = sl.routes.arrive[sl.n % sl.routes.arrive.length];
          if (start(sl, key)) { sl.phase = 'in'; occupied.add(sl.berth.id); sim.arrivals++; }
        }
      } else if (sl.phase === 'in') {
        if (sim.time - sl.t0 >= sl.trip.dur) {
          sl.phase = 'dock';
          sl.trip = null;
          sl.wait = FERRY.dock * (0.92 + 0.3 * rnd());
        }
      } else if (sl.phase === 'dock') {
        sl.wait -= dt;
        if (sl.wait <= 0) {
          const key = sl.routes.depart[sl.n % sl.routes.depart.length];
          if (start(sl, key)) { sl.phase = 'out'; sim.departures++; }
        }
      } else if (sl.phase === 'out') {
        const tau = sim.time - sl.t0;
        if (tau >= sl.trip.clearT) occupied.delete(sl.berth.id);
        if (tau >= sl.trip.dur) {
          sl.phase = 'empty';
          sl.trip = null;
          sl.n++;
          sl.wait = FERRY.gapMin + rnd() * (FERRY.gapMax - FERRY.gapMin);
        }
      }
    }
  }

  const P = {};
  /** Każdy prom widoczny w tej chwili: fn(slot, poza { x, z, h, speed, rev, fade }, stoi). */
  function each(fn) {
    for (const sl of slots) {
      if (sl.phase === 'dock') {
        P.x = sl.berth.x; P.z = sl.berth.z; P.h = sl.berth.heading; P.speed = 0; P.rev = 0; P.fade = 1;
        fn(sl, P, true);
      } else if (sl.trip) {
        sl.trip.pose(sim.time - sl.t0, P);
        fn(sl, P, false);
      }
    }
  }

  function stats() {
    const c = { empty: 0, in: 0, dock: 0, out: 0 };
    for (const sl of slots) c[sl.phase]++;
    return { time: sim.time, arrivals: sim.arrivals, departures: sim.departures, held: sim.held, ...c };
  }

  return { slots, step, each, stats, get time() { return sim.time; } };
}

// ---------------------------------------------------------------------------
// Kolej pasażerska na kratownicy pod drogą: składy jadą torem po swojej stronie osi (ruch prawostronny), stają na
// przystankach dzielnicy, poza dzielnicą znikają. Położenie składu = funkcja czasu (bez stanu).

export const RAIL = Object.freeze({ speed: 430, dwell: 16, off: 100, span: DW.sHalf + 1700 });

/** Rozkład jazdy składu: `stops` — s przystanków w kolejności jazdy, `dir` ±1. Zwraca `at(t)` → { s, stop, moving }. */
export function railSchedule(stops, dir, phase = 0) {
  const nodes = [-dir * RAIL.span, ...stops, dir * RAIL.span];
  const legs = [];
  let T = 0;
  for (let i = 0; i + 1 < nodes.length; i++) {
    const dist = Math.abs(nodes[i + 1] - nodes[i]);
    const run = dist / (RAIL.speed * 0.72) + 3;            // rozruch i hamowanie w nogach
    legs.push({ a: nodes[i], b: nodes[i + 1], t0: T, run, stop: i + 1 < nodes.length - 1 });
    T += run + (i + 1 < nodes.length - 1 ? RAIL.dwell : 6);
  }
  const period = T;
  const ease = (u) => u * u * u * (u * (u * 6 - 15) + 10);
  return {
    period,
    at(time, out = {}) {
      const t = (((time + phase * period) % period) + period) % period;
      let leg = legs[legs.length - 1];
      for (const l of legs) if (t >= l.t0) leg = l;
      const u = Math.min(1, (t - leg.t0) / leg.run);
      out.s = leg.a + (leg.b - leg.a) * ease(u);
      out.moving = u < 1;
      out.stop = !out.moving && leg.stop;
      out.hidden = Math.abs(out.s) > RAIL.span - 60;
      return out;
    }
  };
}
