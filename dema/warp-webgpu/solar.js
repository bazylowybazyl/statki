// dema/warp-webgpu/solar.js
//
// Układ słoneczny i trasy skoku — przeniesione ze sceny 4 dema propozycji 1
// (dema/warp-demo.js: buildDemoSystem, buildTrip, buildTravelTable), bez
// planet3d.assets.js: ciała to dane (położenie, promień wizualny jak w grze,
// księżyce na orbitach), rysuje je planets.js.
//
// Promienie jak w grze: planety przy ringu „Halo” (Ziemia, Mars, Jowisz) —
// RING_PLANET_WORLD_RADII, reszta r × 4,5 (PLANET_SIZE_MULTIPLIER), Księżyc
// 0,24 promienia Ziemi na orbicie 3 × R, księżyce Jowisza z JUPITER_MOONS_TUNE.
// Kąty orbit dobrane pod przeloty: Ziemia → Jowisz mija Marsa 70 tys. j. od
// kursu, Ziemia → Saturn — Jowisza z księżycami, Ziemia → Merkury — Wenus;
// start z Ziemi mija Księżyc tuż po skoku (ciała po stronie dalszej od słońca).
//
// Oś czasu podróży (propozycja 2): postój → ŁADOWANIE (rozpęd w hipercruise,
// planeta startu stoi przy krawędzi kadru i maleje — „dolly zoom”) → SKOK
// (kopnięcie w 0,6 s) → przelot (zwolnienie przy mijanych ciałach) →
// WYJŚCIE GWAŁTOWNE (0,35 s: statek staje, ciała i cel wskakują na prawdziwe
// miejsca, gwiazdy wracają do punktów — jak w Star Wars) → postój przy celu:
// brzeg tarczy przed dziobem (lustro startu nad Ziemią). Zatrzymanie NAD
// tarczą (propozycja 1) dawało w demie bez ringu ekran pełen rozmytej tekstury.

import { buildSystemMap } from '../../src/data/systemMap.js';
import { RING_PLANET_WORLD_RADII } from '../../src/3d/ringScale.js';
import { warpFlybySlowdown } from '../../src/game/warpDrive.js';

export const SUN = Object.freeze({ x: 6000000, y: 6000000 });
export const TRIP_IDS = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn'];
export const PLANET_LABELS = {
  mercury: 'Merkury', venus: 'Wenus', earth: 'Ziemia', mars: 'Mars', jupiter: 'Jowisz', saturn: 'Saturn',
  moon: 'Księżyc', io: 'Io', europa: 'Europa', ganymede: 'Ganimedes', callisto: 'Kallisto'
};

const PLANET_SIZE_MULTIPLIER = 4.5;
const MOON = { orbitRadiusMul: 3.0, orbitRadiusMin: 30000, orbitPeriodSec: 220, sizeRatioToParent: 0.24 };
const JUPITER_MOONS = [
  { id: 'io', orbitRadius: 86000, orbitPeriodSec: 352, sizeRatioToParent: 0.05, phase: 0.0 },
  { id: 'europa', orbitRadius: 105000, orbitPeriodSec: 412, sizeRatioToParent: 0.042, phase: 1.4 },
  { id: 'ganymede', orbitRadius: 165000, orbitPeriodSec: 669, sizeRatioToParent: 0.06, phase: 2.2 },
  { id: 'callisto', orbitRadius: 250000, orbitPeriodSec: 1016, sizeRatioToParent: 0.055, phase: 3.1 }
];

export const TRAVEL = Object.freeze({
  idle: 0.8,
  depart: 3.0,        // rozpęd w hipercruise = ładowanie skoku
  departSpeed: 4000,  // j/s na końcu rozpędu
  zoomOut: 0.55,      // kamera na czas skoku (× zoom startu)
  kick: 0.6,          // SKOK: rozpęd do prędkości warpa
  lensKick: 0.5,      // … ciała wchodzą w soczewkę
  decel: 0.35,        // WYJŚCIE: hamowanie (gwałtowne)
  snap: 0.3,          // … ciała i cel wskakują na prawdziwe miejsca
  hold: 4.2           // postój nad celem do końca pętli
});
const TRAVEL_DT = 1 / 240;
const START_EDGE_PX = 288;
const STOP_EDGE_PX = 260;
const MOON_PASS_SIDE = 40000;

const smooth01 = (x) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };

function routeOrbitHit(a, b, rOrb, S0) {
  const f = (t) => Math.hypot(a.x + (b.x - a.x) * t - S0.x, a.y + (b.y - a.y) * t - S0.y) - rOrb;
  let t0 = 0;
  let f0 = f(0);
  for (let i = 1; i <= 200; i++) {
    const t1 = i / 200;
    const f1 = f(t1);
    if (Math.sign(f1) !== Math.sign(f0)) {
      let lo = t0;
      let hi = t1;
      for (let k = 0; k < 50; k++) {
        const mid = (lo + hi) * 0.5;
        if (Math.sign(f(mid)) === Math.sign(f0)) lo = mid; else hi = mid;
      }
      const t = (lo + hi) * 0.5;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    t0 = t1;
    f0 = f1;
  }
  return null;
}

/**
 * Ciała układu. Planeta: { id, x, y, r, farPlane, kind: 'planet' }, księżyc:
 * { id, parentId, R (orbita), a0, w, r, kind: 'moon' } — położenie z at(t).
 */
export function buildSolarSystem() {
  const ANG = { mercury: 170, venus: 180, earth: 200, mars: 0, jupiter: 250, saturn: 310 };
  const { planets: all } = buildSystemMap(0, { planetScale: 1, sunRadius: 823, angleFor: (def) => (ANG[def.id] ?? 0) * Math.PI / 180 });
  const planets = all.filter((p) => ANG[p.id] !== undefined).map((p) => ({ ...p }));
  for (const p of planets) {
    p.x = SUN.x + Math.cos(p.angle) * p.orbitRadius;
    p.y = SUN.y + Math.sin(p.angle) * p.orbitRadius;
  }
  const byId = Object.fromEntries(planets.map((p) => [p.id, p]));
  const place = (p, x, y) => { p.x = x; p.y = y; };
  const stage = (body, a, b, side) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const hit = routeOrbitHit(a, b, body.orbitRadius, SUN);
    if (!hit) return;
    const k = ((SUN.x - hit.x) * -uy + (SUN.y - hit.y) * ux) > 0 ? -side : side;
    place(body, hit.x - uy * k, hit.y + ux * k);
  };
  const E = byId.earth;
  const J = byId.jupiter;
  stage(byId.mars, E, J, 70000);
  stage(byId.venus, E, byId.mercury, 35000);
  const lj = Math.hypot(J.x - E.x, J.y - E.y);
  const px = -(J.y - E.y) / lj;
  const py = (J.x - E.x) / lj;
  const ks = ((SUN.x - J.x) * px + (SUN.y - J.y) * py) > 0 ? 35000 : -35000;
  const q = { x: J.x + px * ks, y: J.y + py * ks };
  const far = { x: E.x + (q.x - E.x) * 4, y: E.y + (q.y - E.y) * 4 };
  const hitS = routeOrbitHit(q, far, byId.saturn.orbitRadius, SUN);
  if (hitS) place(byId.saturn, hitS.x, hitS.y);

  const bodies = [];
  for (const p of planets) {
    const ring = RING_PLANET_WORLD_RADII[p.id];
    bodies.push({ id: p.id, kind: 'planet', x: p.x, y: p.y, r: ring || p.r * PLANET_SIZE_MULTIPLIER, farPlane: !ring });
  }
  const bodyById = Object.fromEntries(bodies.map((b) => [b.id, b]));
  const earth = bodyById.earth;
  bodies.push({
    id: 'moon', kind: 'moon', parentId: 'earth', farPlane: false,
    R: Math.max(MOON.orbitRadiusMin, earth.r * MOON.orbitRadiusMul),
    a0: 0.4, w: (Math.PI * 2) / MOON.orbitPeriodSec, r: earth.r * MOON.sizeRatioToParent, x: 0, y: 0
  });
  const jup = bodyById.jupiter;
  for (const m of JUPITER_MOONS) {
    bodies.push({
      id: m.id, kind: 'moon', parentId: 'jupiter', farPlane: false, R: m.orbitRadius, a0: m.phase,
      w: (Math.PI * 2) / m.orbitPeriodSec, r: Math.max(900, jup.r * m.sizeRatioToParent), x: 0, y: 0
    });
  }
  for (const b of bodies) if (b.kind === 'moon') b.parent = bodyById[b.parentId];
  const system = {
    bodies,
    byId: Object.fromEntries(bodies.map((b) => [b.id, b])),
    /** Ustawia x, y księżyców w chwili t (planety stoją). */
    at(t) {
      for (const b of bodies) {
        if (b.kind !== 'moon') continue;
        b.x = b.parent.x + Math.cos(b.a0 + b.w * t) * b.R;
        b.y = b.parent.y + Math.sin(b.a0 + b.w * t) * b.R;
      }
      return bodies;
    }
  };
  return system;
}

export function tripKickAt() { return TRAVEL.idle + TRAVEL.depart; }
export function tripStopAt(trip) { return tripKickAt() + trip.warpTime; }

/** Trasa: start nad brzegiem planety startu, koniec przed brzegiem celu. */
export function buildTrip(system, fromId, toId, W, H, focal = 1712) {
  const O = system.byId[fromId];
  const D = system.byId[toId];
  const len = Math.hypot(D.x - O.x, D.y - O.y);
  const ux = (D.x - O.x) / len;
  const uy = (D.y - O.y) / len;
  const zoom0 = Math.min(W, H * 1.6) / 11000;
  // Skala zwykłego widoku planety startu: przy ringu = zoom, w tle — perspektywa 50 tys. j. niżej.
  const flat0 = O.farPlane ? focal / (focal / zoom0 + 50000) : zoom0;
  const alt = START_EDGE_PX / Math.max(1e-6, flat0);
  const P0 = { x: O.x + ux * (O.r + alt), y: O.y + uy * (O.r + alt) };
  const flatD = D.farPlane ? focal / (focal / zoom0 + 50000) : zoom0;
  const stop = D.r + STOP_EDGE_PX / Math.max(1e-6, flatD);
  const P1 = { x: D.x - ux * stop, y: D.y - uy * stop };
  const dist = Math.hypot(P1.x - P0.x, P1.y - P0.y);
  const warpTime = Math.min(17, Math.max(8, 4 + dist / 260000));
  // Start z Ziemi: Księżyc mijany ~0,35 s po skoku, 40 tys. j. od kursu.
  if (fromId === 'earth') {
    const moon = system.byId.moon;
    const along = Math.sqrt(Math.max(0, moon.R * moon.R - MOON_PASS_SIDE * MOON_PASS_SIDE));
    const side = ((SUN.x - O.x) * -uy + (SUN.y - O.y) * ux) > 0 ? -MOON_PASS_SIDE : MOON_PASS_SIDE;
    const mx = O.x + ux * along - uy * side;
    const my = O.y + uy * along + ux * side;
    moon.a0 = Math.atan2(my - O.y, mx - O.x) - moon.w * (tripKickAt() + 0.35);
  } else {
    system.byId.moon.a0 = 0.4;
  }
  const flyby = system.bodies.filter((b) => b !== O && b !== D && !(b.kind === 'moon' && b.parentId === D.id));
  const trip = { fromId, toId, origin: O, target: D, P0, P1, ux, uy, heading: Math.atan2(uy, ux), dist, zoom0, warpTime, flyby, originAlt: alt };
  trip.table = buildTravelTable(system, trip);
  return trip;
}

function travelBaseSpeed(tau, vc, trip) {
  const tKick = tripKickAt();
  const tStop = tripStopAt(trip);
  if (tau < TRAVEL.idle || tau >= tStop) return 0;
  if (tau < tKick) return TRAVEL.departSpeed * smooth01((tau - TRAVEL.idle) / TRAVEL.depart);
  let v = TRAVEL.departSpeed + (vc - TRAVEL.departSpeed) * smooth01((tau - tKick) / TRAVEL.kick);
  const tDec = tStop - TRAVEL.decel;
  if (tau > tDec) {
    const rem = 1 - (tau - tDec) / TRAVEL.decel;
    v = Math.min(v, vc * rem * rem);
  }
  return v;
}

function buildTravelTable(system, trip) {
  const n = Math.ceil(tripStopAt(trip) / TRAVEL_DT) + 2;
  const m = trip.flyby.length;
  const k2 = 2 * n;
  const A = new Float64Array(m * k2);
  const C = new Float64Array(m * k2);
  for (let k = 0; k < k2; k++) {
    system.at(k * TRAVEL_DT * 0.5);
    for (let j = 0; j < m; j++) {
      const b = trip.flyby[j];
      const ox = b.x - trip.P0.x;
      const oy = b.y - trip.P0.y;
      A[j * k2 + k] = ox * trip.ux + oy * trip.uy;
      C[j * k2 + k] = -ox * trip.uy + oy * trip.ux;
    }
  }
  const speedAt = (k, t, pos, vc) => {
    let v = travelBaseSpeed(t, vc, trip);
    if (!(v > 0)) return 0;
    for (let j = 0; j < m; j++) v *= warpFlybySlowdown(A[j * k2 + k] - pos, C[j * k2 + k], trip.flyby[j].r);
    return v;
  };
  const s = new Float64Array(n);
  const v = new Float64Array(n);
  const run = (vc) => {
    let pos = 0;
    for (let i = 0; i < n; i++) {
      const t = i * TRAVEL_DT;
      s[i] = pos;
      v[i] = speedAt(2 * i, t, pos, vc);
      const vm = speedAt(2 * i + 1, t + TRAVEL_DT * 0.5, pos + v[i] * TRAVEL_DT * 0.5, vc);
      pos += vm * TRAVEL_DT;
    }
    return s[n - 1];
  };
  const dist = trip.dist;
  let a = dist / Math.max(1, trip.warpTime - 1);
  let b = dist / Math.max(1, trip.warpTime - 4);
  let fa = run(a) - dist;
  let fb = run(b) - dist;
  for (let k = 0; k < 16 && Math.abs(fb) > 1; k++) {
    const c = b - fb * (b - a) / (fb - fa || 1e-9);
    a = b; fa = fb;
    b = Math.max(c, TRAVEL.departSpeed * 2);
    fb = run(b) - dist;
  }
  run(b);
  return { s, v, vc: b, n };
}

/** Stan podróży w chwili tau: droga i prędkość prawdziwa, soczewka ciał, faza. */
export function tripProfile(trip, tau, out = {}) {
  const table = trip.table;
  const f = Math.min(Math.max(tau / TRAVEL_DT, 0), table.n - 1);
  const i = Math.min(Math.floor(f), table.n - 2);
  const k = f - i;
  out.s = table.s[i] + (table.s[i + 1] - table.s[i]) * k;
  out.v = table.v[i] + (table.v[i + 1] - table.v[i]) * k;
  out.vc = table.vc;
  out.vBase = travelBaseSpeed(tau, table.vc, trip);
  const tKick = tripKickAt();
  const tStop = tripStopAt(trip);
  const tExit = tStop - TRAVEL.decel;
  // Soczewka ciał: pełna po skoku; przy wyjściu gwałtownie do zera
  // (ease-out — cel „wskakuje” pod statek).
  let bodyBeta = 0;
  if (tau >= tKick) bodyBeta = smooth01((tau - tKick) / TRAVEL.lensKick);
  if (tau >= tExit) {
    const u = Math.min(1, (tau - tExit) / TRAVEL.snap);
    bodyBeta *= Math.pow(1 - u, 2.2);
  }
  out.bodyBeta = bodyBeta;
  out.tKick = tKick;
  out.tStop = tStop;
  out.tExit = tExit;
  out.charge = tau >= TRAVEL.idle && tau < tKick ? (tau - TRAVEL.idle) / TRAVEL.depart : (tau >= tKick ? 1 : 0);
  out.phase = tau < TRAVEL.idle ? 'postój' : tau < tKick ? 'ładowanie' : tau < tExit ? 'podróż' : tau < tStop + 0.2 ? 'wyjście' : 'po wyjściu';
  return out;
}
