// dema/silniki-marki/automat.js
//
// Automat silnika dema marek — CZYSTY (bez three i DOM, testy: tests/silnikiMarki.test.mjs).
// Tryb żądany (`mode`) to jeden z TRYBY; automat sam przechodzi przez fazy pośrednie:
//   hipercruise: ROZRUCH (żar osprzętu, struga bez zmian) → zapłon z pchnięciem → LOT → WYJŚCIE (struga opada);
//   warp:        ŁADOWANIE (struga cofa się do pąka przy wylocie, światła osprzętu biegną ku dyszy) → SKOK
//                (błysk, pchnięcie) → LOT → WYJŚCIE (lanca odrywa się od dyszy — osobny „duch” w demie).
// Kanały (0…1, każdy z własnym tempem) czyta mieszanie nastaw strugi (marki.js: blendPlume) i osprzęt dysz.

export const TRYBY = Object.freeze(['jalowy', 'normalny', 'boost', 'hiper', 'warp']);

export const EV_BOOST = 1;          // dopalacz włączony
export const EV_HIPER = 2;          // zapłon hipercruise'u po rozruchu
export const EV_HIPER_WYJSCIE = 4;  // wyjście z hipercruise'u
export const EV_WARP = 8;           // skok po ładowaniu
export const EV_WARP_WYJSCIE = 16;  // wyjście z warpa

export const AUTOMAT = {
  idleThr: 0.16,
  hyperSpool: 1.3,
  hyperDrop: 0.9,
  warpCharge: 2.6,
  warpExit: 1.2,
  // Prędkość pokazowa (gwiazdy tła): ułamek prędkości warpa.
  speed: { jalowy: 0.004, normalny: 0.03, boost: 0.06, hiper: 0.3, warp: 1 }
};

export function createEngine() {
  return {
    mode: 'jalowy',
    phase: 'jalowy',
    t: 0,
    thr: AUTOMAT.idleThr,
    boost: 0,
    hyper: 0,
    charge: 0,
    warp: 0,
    heat: 0.08,
    lamp: 0.1,
    chase: 0,
    kick: 0,
    flash: 0,
    speed: AUTOMAT.speed.jalowy,
    ev: 0
  };
}

export function setEngineMode(e, mode) {
  if (TRYBY.includes(mode)) e.mode = mode;
}

function enter(e, phase) {
  e.phase = phase;
  e.t = 0;
}

function approach(v, target, up, down, dt) {
  const k = 1 - Math.exp(-(target > v ? up : down) * dt);
  return v + (target - v) * k;
}

/** Faza, do której wraca silnik po wyjściu z hipercruise'u / warpa albo po przerwanym rozruchu. */
function landing(want) {
  if (want === 'hiper') return 'hiper-rozruch';
  if (want === 'warp') return 'warp-ladowanie';
  return want;
}

/**
 * Krok automatu. `e.ev` — zdarzenia TEGO kroku (maska EV_*), kasowane na początku następnego.
 * @param {ReturnType<typeof createEngine>} e
 * @param {number} dt sekundy (≥ 0)
 */
export function stepEngine(e, dt, tune = AUTOMAT) {
  e.ev = 0;
  if (!(dt > 0)) return e;
  e.t += dt;
  const want = e.mode;
  switch (e.phase) {
    case 'jalowy':
    case 'normalny':
    case 'boost':
      if (want === 'hiper' || want === 'warp') enter(e, landing(want));
      else if (want !== e.phase) {
        if (want === 'boost') { e.ev |= EV_BOOST; e.kick = Math.max(e.kick, 0.55); e.flash = Math.max(e.flash, 0.35); }
        enter(e, want);
      }
      break;
    case 'hiper-rozruch':
      if (want !== 'hiper') enter(e, landing(want));
      else if (e.t >= tune.hyperSpool) {
        enter(e, 'hiper');
        e.ev |= EV_HIPER;
        e.kick = 1;
        e.flash = Math.max(e.flash, 0.7);
      }
      break;
    case 'hiper':
      if (want !== 'hiper') { enter(e, 'hiper-wyjscie'); e.ev |= EV_HIPER_WYJSCIE; }
      break;
    case 'hiper-wyjscie':
      if (e.t >= tune.hyperDrop) enter(e, landing(want));
      break;
    case 'warp-ladowanie':
      if (want !== 'warp') enter(e, landing(want));
      else if (e.t >= tune.warpCharge) {
        enter(e, 'warp');
        e.ev |= EV_WARP;
        e.kick = 1;
        e.flash = 1;
      }
      break;
    case 'warp':
      if (want !== 'warp') { enter(e, 'warp-wyjscie'); e.ev |= EV_WARP_WYJSCIE; e.flash = Math.max(e.flash, 0.45); }
      break;
    case 'warp-wyjscie':
      if (e.t >= tune.warpExit) enter(e, landing(want));
      break;
    default:
      enter(e, 'jalowy');
  }

  // Cele kanałów z fazy.
  const ph = e.phase;
  let thrT = tune.idleThr;
  let boostT = 0;
  let hyperT = 0;
  let warpT = 0;
  let chargeT = 0;
  let lampT = 0.1;
  let chaseT = 0;
  let speedT = e.speed;
  const sp = tune.speed;
  if (ph === 'jalowy') { speedT = sp.jalowy; }
  else if (ph === 'normalny') { thrT = 1; lampT = 0.28; speedT = sp.normalny; }
  else if (ph === 'boost') { thrT = 1; boostT = 1; lampT = 0.55; speedT = sp.boost; }
  else if (ph === 'hiper-rozruch') { thrT = 0.6; lampT = 0.4 + 0.6 * Math.min(1, e.t / tune.hyperSpool); chaseT = 1; }
  else if (ph === 'hiper') { thrT = 1; hyperT = 1; lampT = 0.75; speedT = sp.hiper; }
  else if (ph === 'hiper-wyjscie') { thrT = 0.7; lampT = 0.3; speedT = sp.boost; }
  else if (ph === 'warp-ladowanie') { thrT = 0.35; chargeT = Math.min(1, e.t / tune.warpCharge); lampT = 0.3 + 1.1 * chargeT; chaseT = 1; }
  else if (ph === 'warp') { thrT = 1; warpT = 1; lampT = 1.2; speedT = sp.warp; }
  else if (ph === 'warp-wyjscie') { thrT = 0.3; lampT = 0.25; speedT = sp.boost; }

  e.thr = approach(e.thr, thrT, 3.2, 2.4, dt);
  e.boost = approach(e.boost, boostT, 6, 2.6, dt);
  e.hyper = approach(e.hyper, hyperT, 5, 3.4, dt);
  e.warp = approach(e.warp, warpT, 11, 12, dt);
  // Ładowanie rośnie liniowo z czasem fazy; po skoku albo przerwaniu opada szybko.
  e.charge = ph === 'warp-ladowanie' ? chargeT : approach(e.charge, 0, 1, 9, dt);
  e.lamp = approach(e.lamp, lampT, 7, 3, dt);
  e.chase = approach(e.chase, chaseT, 6, 2.5, dt);
  // Żar osprzętu ma bezwładność cieplną: grzeje się w ~1 s, stygnie kilka sekund.
  const heatT = Math.min(1.1, 0.22 * e.thr + 0.42 * e.boost + 0.3 * e.hyper + 0.55 * e.warp + 0.5 * e.charge
    + (ph === 'hiper-rozruch' ? 0.8 * Math.min(1, e.t / tune.hyperSpool) : 0));
  e.heat = approach(e.heat, heatT, 1.7, 0.32, dt);
  // Prędkość pokazowa: rozpęd wolny, skok warpa szybki, hamowanie średnie.
  e.speed = approach(e.speed, speedT, ph === 'warp' ? 3.2 : 0.9, 1.6, dt);
  e.kick *= Math.exp(-3.2 * dt);
  e.flash *= Math.exp(-7 * dt);
  return e;
}

/** Podpis fazy do HUD-u. */
export const FAZY_PL = Object.freeze({
  jalowy: 'jałowy',
  normalny: 'normalny',
  boost: 'boost',
  'hiper-rozruch': 'hipercruise — rozruch',
  hiper: 'hipercruise',
  'hiper-wyjscie': 'hipercruise — wyjście',
  'warp-ladowanie': 'warp — ładowanie',
  warp: 'warp',
  'warp-wyjscie': 'warp — wyjście'
});
