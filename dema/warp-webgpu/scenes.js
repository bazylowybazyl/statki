// dema/warp-webgpu/scenes.js
//
// Osie czasu scen dema „Nurt” (propozycja 2, iteracja 2 — uwagi usera
// 2026-09-27). Każda scena to funkcja czasu (poza lotem swobodnym):
// stateAt(t) wypełnia stan klatki — kamerę, statki, bańki i przegródki
// ośrodka, szczeliny tuneli, gwiazdy, świat (planety), fale — w ŚWIECIE GRY
// (x w prawo, y w dół, kąt jak w grze). Jednorazowe zdarzenia przegródek
// (wyrzut, wydech) mają czasy releaseT / rearT — pętla symulacji zapala
// znacznik w kroku, w którym czas minął.
//
// Dwie przestrzenie w podróży: WIDOCZNA (ośrodek, kadłub, kamera — przepływ
// 16–21 tys. j/s) i PRAWDZIWA (planety w soczewce świata — setki tys. j/s,
// solar.js). Ośrodek to warstwa wizualna jak gwiazdy.
//
// Fazy skoku gracza (widok ze środka):
//   ładowanie  bańka rośnie: płaty ośrodka (turkus z przodu, pomarańcz
//              z tyłu), gwiazdy wydłużają się płasko, kamera się oddala,
//              planeta startu stoi przy krawędzi i maleje (dolly zoom);
//   SKOK       kopnięcie: statek wyrywa się do przodu w kadrze (kamera go
//              dogania), gwiazdy strzelają w smugi z przestrzałem, planeta
//              startu ucieka za rufę, fala w punkcie skoku;
//   podróż     opływ bańki, warkocz; mijane planety rosną, obracają się,
//              maleją (prawdziwe odległości); cel wisi przy krawędzi;
//   WYJŚCIE    gwałtowne (user: „jak w Star Wars”): w ~0,3 s statek staje,
//              smugi gwiazd i ośrodka wracają do punktów, bańka zapada się od
//              dziobu, cel wskakuje pod statek, błysk, fala, wstrząs, żar.
// Przyloty i odloty NPC — tunelem (arrivals.js).

import { createFreeWorld } from './freeWorld.js';
import { planArrival, arrivalState, planDeparture, departureState } from './arrivals.js';
import { buildTrip, tripProfile, tripKickAt, tripStopAt, TRAVEL } from './solar.js';
import { planWarpFleetArrival } from '../../src/game/warpDrive.js';

export const STEP = 1 / 240;

// Kształt bańki względem kadłuba.
export const BUBBLE_SHAPE = Object.freeze({ radiusK: 0.62, asp: 1.35 });
// Widoczna prędkość przepływu ośrodka w podróży (bieg I / II).
export const WARP_FLOW = Object.freeze({ gear1: 16000, gear2: 21000 });

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeOut3 = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const lerp = (a, b, t) => a + (b - a) * t;
/** Impuls 0 → 1 → 0 (narasta w `rise`, gaśnie z czasem `fall`). */
const pulse = (t, rise, fall) => (t <= 0 ? 0 : (1 - Math.exp(-t / rise)) * Math.exp(-t / fall));

/** Droga z prędkości (całkowanie co 1/480 s) → s(t). */
function buildPath(speedFn, T, h = 1 / 480) {
  const n = Math.ceil(T / h) + 2;
  const s = new Float64Array(n);
  let acc = 0;
  let prev = speedFn(0);
  for (let i = 1; i < n; i++) {
    const v = speedFn(i * h);
    acc += (prev + v) * 0.5 * h;
    s[i] = acc;
    prev = v;
  }
  return (t) => {
    const x = Math.max(0, t) / h;
    const i = Math.min(n - 2, Math.floor(x));
    const f = Math.min(1, x - i);
    return s[i] + (s[i + 1] - s[i]) * f;
  };
}

export function newBubble() {
  return {
    on: false, x: 0, y: 0, angle: 0, vx: 0, vy: 0, R: 1000, asp: BUBBLE_SHAPE.asp,
    A: 0, front: 3, strain: 0, turb: 0.12, pullR: 1, pullGain: 0, jetSpeed: 0,
    heraldLen: 0, heraldGain: 0, excite: 1, releaseT: Infinity, rearT: Infinity, lensAmp: 0
  };
}

export function newShip(inst) {
  return {
    inst, visible: true, x: 0, y: 0, angle: 0, vx: 0, vy: 0,
    revealMode: 0, revealLine: 0, seamLine: 0, seam: 0, heat: 0, thrust: 0, plasma: 0, smear: 0, smearLen: 1
  };
}

/** Stan klatki (jeden obiekt na scenę, wypełniany co wywołanie). */
export function newFrame() {
  return {
    cam: { x: 0, y: 0, zoom: 0.14 },
    shake: 0,
    ships: [],
    bubbles: [],
    seams: [],
    rifts: [],
    seamLens: [],
    stars: { stretch: 0, angle: 0, frontOn: 0, frontS: 0, warpTint: 0, speedCap: 14000, refX: 0, refY: 0 },
    warpVis: 0,
    mediumFade: 0,   // [1/s] gaszenie całego ośrodka (po wyjściu z warpa)
    waves: [],
    flashes: [],
    glares: [],
    world: null,
    phase: '',
    speedLabel: 0,
    trueSpeed: 0,
    loopLen: 0
  };
}

function clearLists(F) {
  F.bubbles.length = 0;
  F.seams.length = 0;
  F.rifts.length = 0;
  F.seamLens.length = 0;
  F.waves.length = 0;
  F.flashes.length = 0;
  F.glares.length = 0;
}

// ===========================================================================
// Wspólne dla skoku gracza: bańka, gwiazdy.

function playerBubble(bub, ship, R, c) {
  bub.x = ship.x;
  bub.y = ship.y;
  bub.angle = ship.angle;
  bub.vx = ship.vx;
  bub.vy = ship.vy;
  bub.R = R;
  bub.asp = BUBBLE_SHAPE.asp;
  bub.A = c.A;
  bub.front = c.front;
  bub.strain = c.strain;
  bub.turb = 0.13;
  bub.pullR = 1;
  bub.pullGain = 0;
  bub.jetSpeed = 0;
  bub.heraldLen = 0;
  bub.heraldGain = 0;
  bub.excite = c.excite;
  bub.releaseT = Infinity;
  bub.rearT = c.rearT;
  bub.lensAmp = 26 * c.A;
}

/** Rozciągnięcie gwiazd: ładowanie → przestrzał przy kopnięciu → lot → trzask przy wyjściu. */
function starStretch(tau, tKick, tExit, charge, speedFrac) {
  if (tau < tKick) return 0.32 * charge * charge;
  let s;
  const k = tau - tKick;
  if (k < 0.12) s = lerp(0.32, 1.4, easeOut3(k / 0.12));
  else s = lerp(1.4, 1.0, smooth(0.12, 0.55, k));
  s *= 0.55 + 0.45 * clamp01(speedFrac);
  if (tau >= tExit) {
    const u = (tau - tExit) / 0.16;
    s *= u >= 1 ? 0 : Math.pow(1 - u, 1.6);
  }
  return s;
}

// ===========================================================================
// SCENA 1 — podróż Atlasa między planetami: ładowanie → SKOK → przelot → WYJŚCIE

export function createTripScene(ctx) {
  const atlas = ctx.atlas;
  const L = atlas.type.length;
  const R = L * BUBBLE_SHAPE.radiusK;
  const a = R * BUBBLE_SHAPE.asp;
  const F = newFrame();
  const ship = newShip(atlas);
  F.ships.push(ship);
  const bub = newBubble();
  const kickPos = { x: 0, y: 0 };
  const _prof = {};
  let trip = null;
  let visPath = null;
  const vis0 = { x: 0, y: 0 };
  let T = null;

  function rebuild() {
    trip = buildTrip(ctx.system, ctx.trip.from, ctx.trip.to, ctx.viewW, ctx.viewH, ctx.focal());
    const tKick = tripKickAt();
    const tStop = tripStopAt(trip);
    T = { kick: tKick, stop: tStop, exit: tStop - TRAVEL.decel, loop: tStop + TRAVEL.hold };
    F.loopLen = T.loop;
    // Widoczny przepływ: hipercruise w ładowaniu, kopnięcie w 0,45 s, przelot
    // (wolniej przy mijanych ciałach), wyjście w 0,25 s.
    const flowAt = (tau) => {
      if (tau < TRAVEL.idle) return 260;
      if (tau < tKick) return lerp(260, 900, smooth(TRAVEL.idle, tKick, tau));
      const pr = tripProfile(trip, tau, _prof);
      const U = Math.max(2500, WARP_FLOW.gear2 * Math.pow(clamp01(pr.v / pr.vc), 0.6));
      let v = lerp(900, U, easeOut3((tau - tKick) / 0.45));
      if (tau >= T.exit) v = lerp(v, 160, easeOut3((tau - T.exit) / 0.25));
      return v;
    };
    visPath = buildPath(flowAt, T.loop + 1);
    const pos = visPath(tKick);
    kickPos.x = vis0.x + Math.cos(trip.heading) * pos;
    kickPos.y = vis0.y + Math.sin(trip.heading) * pos;
  }

  function stateAt(tau) {
    clearLists(F);
    const pr = tripProfile(trip, tau, _prof);
    const heading = trip.heading;
    const c = Math.cos(heading);
    const sn = Math.sin(heading);
    const sVis = visPath(tau);
    const vVis = (visPath(tau + 1 / 480) - sVis) * 480;
    ship.x = vis0.x + c * sVis;
    ship.y = vis0.y + sn * sVis;
    ship.angle = heading;
    ship.vx = c * vVis;
    ship.vy = sn * vVis;
    ship.visible = true;
    ship.revealMode = 0;
    ship.smear = 0;
    const charge = pr.charge;
    const inWarp = tau >= T.kick && tau < T.exit;
    ship.plasma = tau < TRAVEL.idle ? 0 : (tau < T.kick ? smooth(0.05, 0.5, charge) * (0.55 + 0.45 * charge) : (tau < T.exit ? 1 : Math.exp(-(tau - T.exit) / 0.25)));
    ship.thrust = tau < TRAVEL.idle ? 0.35 : 0.2;
    // Wyjście: front przechodzi przez kadłub w 0,2 s — szew i biały żar brzegu.
    const fx = tau >= T.exit ? lerp(a * 1.3, -a * 1.3, clamp01((tau - T.exit) / 0.2)) : Infinity;
    ship.seamLine = fx;
    ship.seam = Number.isFinite(fx) && fx < L * 0.55 && fx > -L * 0.55 ? 1 : 0;
    ship.heat = tau < T.exit ? 0 : (tau < T.exit + 0.12 ? smooth(T.exit, T.exit + 0.12, tau) : Math.exp(-(tau - T.exit - 0.12) / 2.2));

    // Bańka gracza.
    const inhale = smooth(0.78, 1.0, charge) * (tau < T.kick + 0.2 ? 1 : 0);
    bub.on = tau >= TRAVEL.idle && tau < T.exit + 0.5;
    playerBubble(bub, ship, R, {
      A: tau < T.kick ? Math.pow(smooth(0, 0.85, charge), 1.2) : (tau < T.exit + 0.3 ? 1 : 0),
      front: Number.isFinite(fx) ? fx / a : 3,
      strain: tau < T.kick ? 1.25 + 3.2 * inhale : 0.9,
      excite: tau < T.kick ? 1.6 + 1.2 * inhale : 1,
      rearT: T.exit + 0.19
    });
    if (bub.on) F.bubbles.push(bub);

    // Kamera: oddalenie w ładowaniu, szarpnięcie przy skoku (statek wyrywa się
    // do przodu, kamera go dogania), wyprzedzenie w locie, powrót z uderzeniem.
    const z0 = trip.zoom0;
    let zf = 1;
    if (tau >= TRAVEL.idle) zf = lerp(1, TRAVEL.zoomOut, smooth(TRAVEL.idle, T.kick, tau));
    if (tau >= T.kick) zf = TRAVEL.zoomOut * (1 - 0.1 * pulse(tau - T.kick, 0.04, 0.25));
    if (tau >= T.exit) zf = lerp(TRAVEL.zoomOut, 1, easeOut3((tau - T.exit) / 1.4)) * (1 + 0.1 * pulse(tau - T.exit, 0.03, 0.18));
    const zoom = z0 * zf;
    const leadK = smooth(T.kick, T.kick + 0.7, tau) * (1 - smooth(T.exit, T.exit + 1.1, tau));
    const lead = leadK * 0.26 * (ctx.viewW * 0.5) / zoom;
    const lag = 140 * pulse(tau - T.kick, 0.05, 0.42) / zoom;
    F.cam.x = ship.x + c * (lead - lag);
    F.cam.y = ship.y + sn * (lead - lag);
    F.cam.zoom = zoom;
    F.shake = (tau > TRAVEL.idle + 1.5 && tau < T.kick ? 4 * smooth(TRAVEL.idle + 1.5, T.kick, tau) : 0)
      + 9 * pulse(tau - T.kick, 0.02, 0.25)
      + 11 * pulse(tau - T.exit, 0.02, 0.3);

    // Gwiazdy.
    const st = F.stars;
    st.angle = heading;
    st.stretch = starStretch(tau, T.kick, T.exit, charge, pr.v / pr.vc);
    st.frontOn = tau >= T.exit ? 1 : 0;
    st.frontS = tau >= T.exit ? lerp(18000, -18000, clamp01((tau - T.exit) / 0.22)) : 0;
    st.warpTint = inWarp ? 1 : charge * 0.4;
    st.speedCap = 14000;
    st.refX = ship.x;
    st.refY = ship.y;
    F.warpVis = smooth(T.kick, T.kick + 0.4, tau) * (tau < T.exit ? 1 : Math.max(0, 1 - (tau - T.exit) / 0.2));
    // Po wyjściu ośrodek gaśnie w ~0,3 s (smugi i tak znikają, bo statek stanął) —
    // bez chmury drobin wiszącej wokół okrętu.
    F.mediumFade = tau >= T.exit + 0.1 && tau < T.exit + 1.6 ? 6 : 0;

    // Świat (planety) — prawdziwe położenie statku na trasie. Od chwili wyjścia
    // statek JUŻ JEST u celu (hamowanie z setek tys. j/s to ~27 tys. j. drogi —
    // w skali ciał cel najpierw uciekałby z kadru, potem wracał): soczewka
    // przechodzi wprost w prawdziwy widok i cel rośnie pod statkiem bez przerwy.
    const w = F.world || (F.world = { ship: { x: 0, y: 0 } });
    const sTrue = tau >= T.exit ? trip.dist : pr.s;
    w.ship.x = trip.P0.x + trip.ux * sTrue;
    w.ship.y = trip.P0.y + trip.uy * sTrue;
    w.heading = heading;
    w.speed = pr.vBase;
    w.beta = pr.bodyBeta;
    w.bodyZoom = 1;
    if (tau < T.kick + TRAVEL.lensKick && trip.originAlt > 0) {
      w.bodyZoom = trip.originAlt / Math.max(trip.originAlt + pr.s, 1) / zf;
    }
    w.target = trip.target;
    w.time = tau;

    // Fale (przezroczyste) i błyski. Błysk skoku za rufą (w punkcie, od którego
    // statek się odbił) — na kadłubie byłby plamą na środku okrętu.
    if (tau >= T.kick && tau < T.kick + 1.4) {
      const age = tau - T.kick;
      F.waves.push({ x: kickPos.x, y: kickPos.y, r: 9000 * age, width: 320, amp: 8 * (1 - age / 1.4) ** 2 });
      if (age < 0.35) F.flashes.push({ x: kickPos.x - c * L * 0.62, y: kickPos.y - sn * L * 0.62, size: R * 0.5, k: (1 - age / 0.35) ** 2, pal: atlas.type.palette });
    }
    if (tau >= T.exit && tau < T.exit + 1.6) {
      const age = tau - T.exit;
      F.waves.push({ x: ship.x, y: ship.y, r: 7500 * age, width: 420, amp: 12 * (1 - age / 1.6) ** 2 });
      if (age < 0.3) F.flashes.push({ x: ship.x + c * L * 0.5, y: ship.y + sn * L * 0.5, size: R * 0.6, k: 1.3 * (1 - age / 0.3) ** 2, pal: null });
    }
    F.phase = pr.phase;
    F.speedLabel = vVis;
    F.trueSpeed = pr.v;
    return F;
  }

  return {
    name: 'trip',
    frame: F,
    get T() { return T; },
    get trip() { return trip; },
    minZoom: 0.07,
    get markers() {
      return [
        { t: TRAVEL.idle, label: 'ładowanie' },
        { t: T.kick, label: 'skok' },
        { t: T.kick + 2, label: 'podróż' },
        { t: T.exit - 0.6, label: 'wyjście' }
      ];
    },
    reset() {
      rebuild();
    },
    loopOrigin() { return { x: 0, y: 0 }; },
    stateAt
  };
}

// ===========================================================================
// SCENA 2 — przylot okrętu tunelem obok Atlasa, po chwili odlot (pętla)

export function createArrivalScene(ctx) {
  const F = newFrame();
  const atlasShip = newShip(ctx.atlas);
  atlasShip.angle = -0.35;
  atlasShip.thrust = 0.2;
  let arr = null;
  let dep = null;
  F.loopLen = 15;
  return {
    name: 'arrival',
    frame: F,
    T: { loop: 15 },
    minZoom: 0.1,
    markers: [
      { t: 0.3, label: 'zwiastun' },
      { t: 2.6, label: 'rozdarcie' },
      { t: 3.2, label: 'wyrzut' },
      { t: 8.8, label: 'odlot' }
    ],
    reset() {
      const inst = ctx.npc('arrival', ctx.arrivalHull());
      const ship = newShip(inst);
      const pirate = ctx.arrivalHull().startsWith('pirate');
      arr = planArrival({ ship, x: -2300, y: -1700, angle: -0.5, t0: 0.3, pirate });
      dep = planDeparture({ ship, x: -2300, y: -1700, angle: -0.5, t0: 8.8, pirate });
      F.loopLen = Math.max(15, dep.tEnd + 1.2);
    },
    loopOrigin() { return { x: 0, y: 0 }; },
    stateAt(t) {
      clearLists(F);
      F.ships.length = 0;
      F.ships.push(atlasShip);
      const shake = t < dep.t0 ? arrivalState(arr, t, F) : departureState(dep, t, F);
      F.ships.push(arr.ship);
      F.cam.x = -900;
      F.cam.y = -900;
      F.cam.zoom = 0.13;
      F.shake = shake * 6;
      F.stars.stretch = 0;
      F.stars.frontOn = 0;
      F.warpVis = 0;
      F.world = null;
      const ph = arr.sample.phase;
      F.phase = t >= dep.t0 ? (t < dep.tDive ? 'ładowanie odlotu' : 'odlot') : ph === 'herald' ? 'zwiastun' : ph === 'tear' ? 'rozdarcie' : ph === 'emerge' ? 'wyrzut' : 'po przylocie';
      F.speedLabel = 0;
      return F;
    }
  };
}

// ===========================================================================
// Floty (wezwanie, zasadzka): zwiastuny razem, wyrzuty od najmniejszego okrętu.

const FLEET_FORMATION = [
  { type: 'supercapital', ax: 0, ay: 0 },
  { type: 'battleship', ax: -900, ay: -1250 },
  { type: 'battleship', ax: -900, ay: 1250 },
  { type: 'destroyer', ax: -1500, ay: -2150 },
  { type: 'destroyer', ax: -1500, ay: 2150 },
  { type: 'frigate', ax: -2050, ay: -2900 },
  { type: 'frigate', ax: -2050, ay: 2900 },
  { type: 'frigate', ax: -2300, ay: 0 }
];

function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function summonFormation(pools, layout, t0, x, y, angle, seed, pirate = false) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const items = [];
  for (const f of layout) {
    const inst = pools.take(f.type);
    if (inst) items.push({ f, inst });
  }
  const plan = planWarpFleetArrival(items.map((it) => ({ hullLength: it.inst.type.length })), {
    gap: pirate ? 0.16 : 0.2, flagshipPause: pirate ? 0.35 : 0.5, jitter: pirate ? 0.5 : 0.3, rng: seededRng(seed)
  });
  return plan.map((p) => {
    const { f, inst } = items[p.index];
    const px = f.abs ? f.x : x + f.ax * c - f.ay * s;
    const py = f.abs ? f.y : y + f.ax * s + f.ay * c;
    const ang = f.abs ? f.angle : angle;
    const ship = newShip(inst);
    return { ship, inst, arr: planArrival({ ship, x: px, y: py, angle: ang, t0: t0 + p.startTime, heraldExtra: p.heraldExtra, pirate }), dep: null };
  });
}

/** Stan jednostek floty (przylot, potem ewentualny odlot) → wstrząs. */
function fleetState(units, t, F) {
  let shake = 0;
  for (const u of units) {
    if (u.dep && t >= u.dep.t0) {
      if (t > u.dep.tEnd) continue;
      shake = Math.max(shake, departureState(u.dep, t, F));
    } else {
      shake = Math.max(shake, arrivalState(u.arr, t, F));
    }
    F.ships.push(u.ship);
  }
  return shake;
}

// ===========================================================================
// SCENA 3 — wezwanie floty: klik = flota Terra Nova w tym miejscu (poprzednia odlatuje)

export function createFleetScene(ctx) {
  const F = newFrame();
  const atlasShip = newShip(ctx.atlas);
  atlasShip.angle = -0.35;
  atlasShip.thrust = 0.2;
  const calls = [];
  let autoNext = 0.3;
  const AUTO = [
    { x: 2600, y: -2900, angle: 0 },
    { x: -3000, y: 2300, angle: -2.4 },
    { x: 3300, y: 2000, angle: 2.6 }
  ];
  let autoIdx = 0;
  let pools = null;
  let seed = 1;

  function call(t, x, y, angle) {
    const prev = calls[calls.length - 1];
    if (prev && !prev.departing) {
      prev.departing = true;
      prev.units.forEach((u, k) => {
        const td = Math.max(t + 0.4 + k * 0.12, u.arr.tSettled + 0.5);
        u.dep = planDeparture({ ship: u.ship, x: u.arr.x, y: u.arr.y, angle: u.arr.angle, t0: td });
      });
    }
    while (calls.length > 2) {
      const old = calls.shift();
      for (const u of old.units) pools.release(u.inst);
    }
    calls.push({ units: summonFormation(pools, FLEET_FORMATION, t, x, y, angle, seed++), departing: false });
  }

  return {
    name: 'fleet',
    frame: F,
    T: { loop: 0 },
    minZoom: 0.1,
    markers: [],
    reset() {
      for (const cl of calls) for (const u of cl.units) pools?.release(u.inst);
      calls.length = 0;
      pools = ctx.fleetPools();
      autoNext = 0.3;
      autoIdx = 0;
      seed = 1;
    },
    loopOrigin() { return { x: 0, y: 0 }; },
    /** Klik: flota w punkcie świata (x, y), dziobami od Atlasa. */
    call(t, x, y) {
      call(t, x, y, Math.atan2(y, x));
      autoNext = t + 12;
    },
    tick(t) {
      if (t >= autoNext) {
        const p = AUTO[autoIdx++ % AUTO.length];
        call(t, p.x, p.y, p.angle);
        autoNext = t + 12;
      }
    },
    stateAt(t) {
      clearLists(F);
      F.ships.length = 0;
      F.ships.push(atlasShip);
      let shake = 0;
      for (const cl of calls) shake = Math.max(shake, fleetState(cl.units, t, F));
      F.cam.x = 600;
      F.cam.y = -300;
      F.cam.zoom = 0.115;
      F.shake = shake * 5;
      F.stars.stretch = 0;
      F.stars.frontOn = 0;
      F.warpVis = 0;
      F.world = null;
      F.phase = 'klik = flota w punkcie (poprzednia odlatuje)';
      F.speedLabel = 0;
      return F;
    }
  };
}

// ===========================================================================
// SCENA 4 — zasadzka piratów: pierścień wokół Atlasa, dziobami do niego

const AMBUSH = ['pirate_frigate', 'pirate_destroyer', 'pirate_battleship', 'pirate_frigate', 'pirate_destroyer', 'pirate_battleship'];

export function createAmbushScene(ctx) {
  const F = newFrame();
  const atlasShip = newShip(ctx.atlas);
  atlasShip.angle = -0.35;
  atlasShip.thrust = 0.2;
  let units = [];
  let pools = null;
  const T = { depart: 9.5, loop: 13.5 };
  F.loopLen = T.loop;
  return {
    name: 'ambush',
    frame: F,
    T,
    minZoom: 0.1,
    markers: [
      { t: 0.2, label: 'zwiastuny' },
      { t: 2.9, label: 'wyrzuty' },
      { t: T.depart, label: 'odwrót' }
    ],
    reset() {
      if (pools) for (const u of units) pools.release(u.inst);
      pools = ctx.fleetPools();
      const layout = AMBUSH.map((type, i) => {
        const ang = (i / AMBUSH.length) * Math.PI * 2 + 0.35;
        const r = type === 'pirate_battleship' ? 3300 : 2700;
        const x = Math.cos(ang) * r;
        const y = Math.sin(ang) * r;
        return { type, abs: true, x, y, angle: Math.atan2(-y, -x) };
      });
      units = summonFormation(pools, layout, 0.2, 0, 0, 0, 7, true);
      units.forEach((u, k) => {
        u.dep = planDeparture({ ship: u.ship, x: u.arr.x, y: u.arr.y, angle: u.arr.angle, t0: T.depart + k * 0.1, pirate: true });
      });
      const end = Math.max(...units.map((u) => u.dep.tEnd));
      F.loopLen = T.loop = Math.max(13.5, end + 0.8);
    },
    loopOrigin() { return { x: 0, y: 0 }; },
    stateAt(t) {
      clearLists(F);
      F.ships.length = 0;
      F.ships.push(atlasShip);
      const shake = fleetState(units, t, F);
      F.cam.x = 0;
      F.cam.y = 0;
      F.cam.zoom = 0.125;
      F.shake = shake * 6;
      F.stars.stretch = 0;
      F.stars.frontOn = 0;
      F.warpVis = 0;
      F.world = null;
      F.phase = t < T.depart ? 'zasadzka' : 'odwrót piratów';
      F.speedLabel = 0;
      return F;
    }
  };
}

// ===========================================================================
// SCENA 5 — lot swobodny: Atlas pod ręką (Shift — ładowanie i skok, Ctrl/C — wyjście)

export function createFreeScene(ctx) {
  const atlas = ctx.atlas;
  const L = atlas.type.length;
  const R = L * BUBBLE_SHAPE.radiusK;
  const a = R * BUBBLE_SHAPE.asp;
  const F = newFrame();
  const ship = newShip(atlas);
  F.ships.push(ship);
  const bub = newBubble();
  const world = createFreeWorld(ctx);
  const st = {
    mode: 'idle', t0: 0, charge: 0, speed: 0, flow: 0, gear: 1, x: 0, y: 0, angle: -0.35, angVel: 0,
    zoom: 0.14, kickT: -10, exitT: -10, kickX: 0, kickY: 0, heat: 0, lastT: 0, gearT: -10, leadK: 0, flow0: 0, stopT: -10
  };
  const CHARGE = 3.0;
  return {
    name: 'free',
    frame: F,
    T: { loop: 0 },
    minZoom: 0.07,
    markers: [],
    state: st,
    get trip() { return world.trip; },
    reset() {
      world.reset();
      Object.assign(st, { mode: 'idle', charge: 0, speed: 0, flow: 0, gear: 1, x: 0, y: 0, angle: world.startAngle, angVel: 0, zoom: world.zoom0, kickT: -10, exitT: -10, heat: 0, lastT: 0, gearT: -10, leadK: 0, flow0: 0, stopT: -10 });
    },
    loopOrigin() { return { x: st.x, y: st.y }; },
    tick(t, dt, keys) {
      st.lastT = t;
      const turn = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
      if (st.mode === 'idle' || st.mode === 'charging') {
        st.angVel += (turn * 0.6 - st.angVel) * (1 - Math.exp(-4 * dt));
        const fwd = keys.has('w') ? 1 : keys.has('s') ? -0.5 : 0;
        st.speed += fwd * 420 * dt;
        st.speed *= Math.exp(-0.25 * dt);
        st.speed = Math.max(-200, Math.min(900, st.speed));
        if (keys.has('shift')) {
          if (st.mode === 'idle') { st.mode = 'charging'; st.t0 = t; }
          st.charge = Math.min(1, st.charge + dt / CHARGE);
          if (st.charge >= 1) {
            st.mode = 'warp';
            st.kickT = t;
            st.kickX = st.x;
            st.kickY = st.y;
            st.gear = 1;
            st.flow = Math.max(st.speed, 300);
          }
        } else if (st.mode === 'charging') {
          st.charge = Math.max(0, st.charge - dt / 0.8);
          if (st.charge <= 0) st.mode = 'idle';
        }
      } else if (st.mode === 'warp') {
        st.angVel += (turn * 0.32 - st.angVel) * (1 - Math.exp(-3 * dt));
        const target = st.gear === 1 ? WARP_FLOW.gear1 : WARP_FLOW.gear2;
        st.flow += (target - st.flow) * (1 - Math.exp(-(t - st.kickT < 0.5 ? 9 : 3.2) * dt));
        st.speed = st.flow;
        // Ctrl jak w grze; C — bezpieczna zamiana (Ctrl + W w przeglądarce zamyka kartę).
        if (keys.has('control') || keys.has('c')) {
          st.mode = 'exit';
          st.exitT = t;
          st.flow0 = st.flow;
        }
      } else if (st.mode === 'exit') {
        st.angVel *= Math.exp(-8 * dt);
        const u = clamp01((t - st.exitT) / 0.25);
        st.speed = lerp(st.flow0, 160, easeOut3(u));
        if (u >= 1) { st.mode = 'cooling'; st.stopT = t; }
      } else if (st.mode === 'cooling') {
        st.speed *= Math.exp(-0.6 * dt);
        if (t - st.stopT > 2.5) { st.mode = 'idle'; st.charge = 0; }
      }
      st.angle += st.angVel * dt;
      st.x += Math.cos(st.angle) * st.speed * dt;
      st.y += Math.sin(st.angle) * st.speed * dt;
      const warpNow = st.mode === 'warp';
      st.leadK += ((warpNow ? 1 : 0) - st.leadK) * (1 - Math.exp(-1.6 * dt));
      const z0 = world.zoom0;
      const zt = st.mode === 'charging' ? lerp(z0, z0 * TRAVEL.zoomOut, st.charge) : warpNow ? z0 * TRAVEL.zoomOut : z0;
      st.zoom += (zt - st.zoom) * (1 - Math.exp(-(st.mode === 'cooling' ? 1.4 : 3) * dt));
      if (st.mode === 'exit' || st.mode === 'cooling') st.heat = Math.max(st.heat * Math.exp(-dt / 2.2), t - st.exitT < 0.12 ? smooth(0, 0.12, t - st.exitT) : 0);
      else st.heat *= Math.exp(-dt / 2.2);
      world.tick(t, dt, st);
    },
    gearUp(t) {
      if (st.mode === 'warp' && st.gear === 1) { st.gear = 2; st.gearT = t; }
    },
    gearDown() {
      if (st.mode === 'warp' && st.gear === 2) st.gear = 1;
    },
    stateAt(t) {
      clearLists(F);
      const lag0 = Math.max(0, t - st.lastT);
      const c = Math.cos(st.angle);
      const s = Math.sin(st.angle);
      ship.x = st.x + c * st.speed * lag0;
      ship.y = st.y + s * st.speed * lag0;
      ship.angle = st.angle;
      ship.vx = c * st.speed;
      ship.vy = s * st.speed;
      ship.visible = true;
      ship.revealMode = 0;
      ship.smear = 0;
      const warp = st.mode === 'warp';
      const cT = st.mode === 'charging' ? st.charge : 0;
      ship.plasma = st.mode === 'charging' ? smooth(0.05, 0.5, cT) * (0.55 + 0.45 * cT) : warp ? 1 : (st.mode === 'exit' ? Math.exp(-(t - st.exitT) / 0.25) : 0);
      ship.thrust = 0.25;
      const exiting = st.mode === 'exit' || (st.mode === 'cooling' && t - st.exitT < 0.4);
      const fx = exiting ? lerp(a * 1.3, -a * 1.3, clamp01((t - st.exitT) / 0.2)) : Infinity;
      ship.seamLine = fx;
      ship.seam = Number.isFinite(fx) && fx < L * 0.55 && fx > -L * 0.55 ? 1 : 0;
      ship.heat = st.heat;
      const inhale = st.mode === 'charging' ? smooth(0.78, 1.0, cT) : 0;
      bub.on = st.mode === 'charging' || warp || exiting;
      playerBubble(bub, ship, R, {
        A: st.mode === 'charging' ? Math.pow(smooth(0, 0.85, cT), 1.2) : (bub.on ? 1 : 0),
        front: Number.isFinite(fx) ? fx / a : 3,
        strain: st.mode === 'charging' ? 1.25 + 3.2 * inhale : 0.9 + 2.2 * Math.exp(-Math.pow((t - st.gearT - 0.1) / 0.18, 2)),
        excite: st.mode === 'charging' ? 1.6 + 1.2 * inhale : 1,
        rearT: st.exitT + 0.19
      });
      if (bub.on && bub.A > 0) F.bubbles.push(bub);
      const lag = 140 * pulse(t - st.kickT, 0.05, 0.42) / st.zoom;
      const lead = st.leadK * 0.26 * (ctx.viewW * 0.5) / st.zoom;
      const zoom = st.zoom * (1 - 0.1 * pulse(t - st.kickT, 0.04, 0.25)) * (1 + 0.1 * pulse(t - st.exitT, 0.03, 0.18));
      F.cam.x = ship.x + c * (lead - lag);
      F.cam.y = ship.y + s * (lead - lag);
      F.cam.zoom = zoom;
      F.shake = (st.mode === 'charging' ? 4 * smooth(0.5, 1, cT) : 0) + 9 * pulse(t - st.kickT, 0.02, 0.25) + 11 * pulse(t - st.exitT, 0.02, 0.3);
      const S2 = F.stars;
      S2.angle = st.angle;
      const vf = warp ? clamp01(st.flow / WARP_FLOW.gear2) : 1;
      S2.stretch = st.mode === 'charging' ? 0.32 * cT * cT
        : warp ? starStretch(t, st.kickT, Infinity, 1, vf)
        : st.mode === 'exit' ? starStretch(t, st.kickT, st.exitT, 1, 1) : 0;
      S2.frontOn = st.mode === 'exit' ? 1 : 0;
      S2.frontS = lerp(18000, -18000, clamp01((t - st.exitT) / 0.22));
      S2.warpTint = warp ? 1 : cT * 0.4;
      S2.refX = ship.x;
      S2.refY = ship.y;
      F.warpVis = warp ? smooth(st.kickT, st.kickT + 0.4, t) : (st.mode === 'exit' ? Math.max(0, 1 - (t - st.exitT) / 0.2) : 0);
      F.mediumFade = t - st.exitT >= 0.1 && t - st.exitT < 1.6 ? 6 : 0;
      F.world = world.state(t, st);
      if (t >= st.kickT && t - st.kickT < 1.4) {
        const age = t - st.kickT;
        F.waves.push({ x: st.kickX, y: st.kickY, r: 9000 * age, width: 320, amp: 8 * (1 - age / 1.4) ** 2 });
        if (age < 0.35) F.flashes.push({ x: st.kickX - c * L * 0.62, y: st.kickY - s * L * 0.62, size: R * 0.5, k: (1 - age / 0.35) ** 2, pal: atlas.type.palette });
      }
      if (t >= st.exitT && t - st.exitT < 1.6) {
        const age = t - st.exitT;
        F.waves.push({ x: ship.x, y: ship.y, r: 7500 * age, width: 420, amp: 12 * (1 - age / 1.6) ** 2 });
        if (age < 0.3) F.flashes.push({ x: ship.x + c * L * 0.5, y: ship.y + s * L * 0.5, size: R * 0.6, k: 1.3 * (1 - age / 0.3) ** 2, pal: null });
      }
      F.phase = st.mode === 'idle' ? 'lot (przytrzymaj Shift)' : st.mode === 'charging' ? `ładowanie ${Math.round(st.charge * 100)}%` : warp ? `warp · bieg ${st.gear} (Ctrl/C — wyjście)` : st.mode === 'exit' ? 'wyjście' : 'po wyjściu';
      F.speedLabel = st.speed;
      F.trueSpeed = world.trueSpeed;
      return F;
    }
  };
}
