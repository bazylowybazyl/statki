// src/game/flight/shipFlightModel.js
//
// Model lotu okrętów NPC w stylu Starsectora: specyfikacja kadłuba jest
// jednocześnie prawem fizyki i planem pilota.
//
// Dlaczego nie dysze z edytora (npcFlight.js):
//  - prowadzenie z dysz WYNIKAŁO z geometrii edytora, masy, bezwładności
//    i tarcia kątowego, więc żaden szablon nie mówił prawdy — fregata „420 u/s"
//    osiągała 109 u/s, a pancernik nie potrafił zawrócić do celu za rufą;
//  - pilot planował hamowanie i obrót z innych liczb niż te, które całkowała
//    fizyka (ta sama klasa błędu co drżenie przy tarczach: dwa źródła jednej
//    granicy).
//
// Podział pracy:
//  - mózg AI (20 Hz, fazowany) ustawia INTENCJĘ: gdzie być, z jaką prędkością
//    odniesienia, jak ustawić kadłub i w jakim trybie prędkości lecieć;
//  - stepShipFlight() w KAŻDYM ticku fizyki (120 Hz) robi pilota i integrację.
//    Tylko ono rusza x/y/vx/vy/angle/angVel — nie ma już dwóch integratorów
//    na zmianę (mózg z dt 0,05 s + ścieżka awaryjna z tarciem na 5 z 6 ticków).
//
// Kolizje z destruktora dopisują impulsy wprost do vx/vy/angVel; integrator
// czyta je co tick, a nadmiar ponad limit wygasza z `decel` / `turnAccel`.

import { SHIP_FLIGHT_CLASS_DEFAULTS, SHIP_FLIGHT_SPECS } from '../../data/shipFlightSpecs.js';
import { resolveEntityHullProfileId } from '../../data/ships.js';
import { composeShipThrusterCommand, updateShipThrusterState } from './thrusterModel.js';

const DEG = Math.PI / 180;

export const FLIGHT_PILOT = Object.freeze({
  // Jak szybko pilot poprawia błąd prędkości (stała czasowa, s).
  velocityTau: 0.3,
  // Hamowanie planujemy z zapasem — reszta pokrywa opóźnienie regulatora.
  brakeMargin: 0.85,
  // Końcówka dojazdu: prędkość liniowa od odległości (1/s), bez „bang-bang".
  approachGain: 1.6,
  // Obrót: planujemy z 85% przyspieszenia kątowego, końcówka liniowa (1/s).
  turnMargin: 0.85,
  turnGain: 5,
  // Jak szybko ω dogania zadaną prędkość obrotu (1/s).
  omegaGain: 14,
  // Separacja AI to przyspieszenie; zamieniamy je na poprawkę PRĘDKOŚCI
  // zadanej na tym horyzoncie (s), żeby przeszła przez limity silników.
  separationHorizon: 0.6,
  // Poniżej tej zadanej prędkości kadłub nie „patrzy w kierunek ruchu".
  moveHeadingMinSpeed: 40,
  // System dopalacza (np. niszczyciel dochodzący do flanki).
  boostAccelMul: 1.6,
  boostSpeedMul: 1.5,
  // Governor ścina nadmiar prędkości tym ułamkiem `decel` (reszta to pilot).
  governorDecelFrac: 0.5,
  // Odświeżanie stanu dysz dla VFX — wizualia, nie fizyka.
  vfxInterval: 1 / 30
});

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

export function wrapFlightAngle(angle) {
  let a = Number(angle) || 0;
  if (a > Math.PI || a < -Math.PI) {
    a = ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  }
  return a;
}

// ---------------------------------------------------------------------------
// Specyfikacja
// ---------------------------------------------------------------------------

const NON_SHIP_TYPE_RE = /fighter|interceptor|drone|bomber|freighter|megafreighter/;

// Id kadłuba z tabeli SHIP_FLIGHT_SPECS albo null, gdy to nie okręt liniowy
// (myśliwiec, frachtowiec, dron...). resolveEntityHullProfileId zwraca 'atlas'
// jako domyślny fallback dla nieznanych typów — Atlasa przyjmujemy więc tylko
// wtedy, gdy byt naprawdę nim jest.
export function resolveShipFlightHullId(entity) {
  if (!entity || entity.fighter) return null;
  const type = String(entity.type || '').toLowerCase();
  if (NON_SHIP_TYPE_RE.test(type)) return null;
  const hullId = resolveEntityHullProfileId(entity);
  if (!SHIP_FLIGHT_SPECS[hullId]) return null;
  if (hullId === 'atlas') {
    const frame = String(entity.shipFrame || entity.activeHullId || '').toLowerCase();
    if (type !== 'atlas' && frame !== 'atlas') return null;
  }
  return hullId;
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function buildShipFlightSpec(hullId, override = null) {
  const hull = SHIP_FLIGHT_SPECS[hullId];
  if (!hull) return null;
  const flightClass = hull.flightClass || 'battleship';
  const base = SHIP_FLIGHT_CLASS_DEFAULTS[flightClass] || SHIP_FLIGHT_CLASS_DEFAULTS.battleship;
  const src = override ? { ...base, ...hull, ...override } : { ...base, ...hull };
  const maxSpeed = Math.max(1, num(src.maxSpeed, base.maxSpeed));
  const cruiseSpeed = maxSpeed + Math.max(0, num(src.cruiseBonus, 0));
  return {
    hullId,
    flightClass,
    maxSpeed,
    accel: Math.max(1, num(src.accel, base.accel)),
    decel: Math.max(1, num(src.decel, base.decel)),
    strafeAccel: Math.max(1, num(src.strafeAccel, base.strafeAccel)),
    reverseAccel: Math.max(1, num(src.reverseAccel, base.reverseAccel)),
    turnRate: Math.max(0.01, num(src.turnRate, base.turnRate) * DEG),
    turnAccel: Math.max(0.01, num(src.turnAccel, base.turnAccel) * DEG),
    cruiseSpeed,
    travelSpeed: Math.max(cruiseSpeed, num(src.travelSpeed, cruiseSpeed)),
    reverseSpeed: maxSpeed * Math.max(0.1, Math.min(1, num(src.reverseSpeedFrac, 0.5)))
  };
}

// Specyfikacja bytu (cache na bycie). Przy pierwszym rozwiązaniu nadpisuje też
// stare pola maxSpeed/accel/turn/turnAccel — czyta je UI floty i starszy kod,
// więc nie mogą zostać drugą, rozjechaną kopią.
export function resolveShipFlightSpec(entity) {
  if (!entity) return null;
  const cached = entity.__flightSpec;
  if (cached) return cached;
  const hullId = resolveShipFlightHullId(entity);
  if (!hullId) return null;
  const spec = buildShipFlightSpec(hullId, entity.flightSpecOverride || null);
  entity.__flightSpec = spec;
  entity.maxSpeed = spec.maxSpeed;
  entity.accel = spec.accel;
  entity.turn = spec.turnRate;
  entity.turnAccel = spec.turnAccel;
  return spec;
}

export function invalidateShipFlightSpec(entity) {
  if (!entity) return;
  entity.__flightSpec = null;
  entity.__flightModel = undefined;
}

// Czy byt lata tym modelem: okręt misji (wezwany, pirat, skrzydło wsparcia)
// o znanym kadłubie. Myśliwce, frachtowce, składy megafreightera i ruch cywilny
// zostają przy swoich ścieżkach.
export function usesShipFlightModel(entity) {
  if (!entity) return false;
  const cached = entity.__flightModel;
  if (cached !== undefined) return cached;
  if (entity.fighter || entity.isCargoVan || entity.staticDummy) {
    entity.__flightModel = false;
    return false;
  }
  // Byt spoza misji może się nią jeszcze stać — nie zapamiętujemy „nie".
  if (!entity.mission) return false;
  const ok = resolveShipFlightSpec(entity) != null;
  entity.__flightModel = ok;
  return ok;
}

export function flightSpeedLimit(spec, mode = 'combat') {
  if (!spec) return 0;
  if (mode === 'travel') return spec.travelSpeed;
  if (mode === 'cruise') return spec.cruiseSpeed;
  return spec.maxSpeed;
}

// Droga hamowania z bieżącej prędkości (u) — do planowania w mózgach AI.
export function flightStoppingDistance(spec, speed) {
  if (!spec) return 0;
  const v = Math.max(0, Number(speed) || 0);
  return (v * v) / (2 * spec.decel * FLIGHT_PILOT.brakeMargin);
}

// Czas obrotu o kąt (rad) ze stanu spoczynku — profil trapezowy.
export function flightTurnTime(spec, angle) {
  if (!spec) return 0;
  const th = Math.abs(Number(angle) || 0);
  const a = spec.turnAccel;
  const w = spec.turnRate;
  const rampAngle = (w * w) / a;
  if (th <= rampAngle) return 2 * Math.sqrt(th / a);
  return th / w + w / a;
}

// ---------------------------------------------------------------------------
// Intencja (ustawia mózg AI / komenda RTS)
// ---------------------------------------------------------------------------

export function getFlightIntent(entity) {
  let it = entity.__flightIntent;
  if (!it) {
    it = entity.__flightIntent = {
      mode: 'stop',
      x: 0,
      y: 0,
      refVx: 0,
      refVy: 0,
      age: 0,
      arrival: 0,
      speedLimit: 0,
      approachCap: Infinity,
      noBrake: false,
      face: NaN,
      faceNear: 0,
      faceFar: 0,
      sepAx: 0,
      sepAy: 0,
      dodgeVx: 0,
      dodgeVy: 0,
      dodgeT: 0,
      boost: false
    };
  }
  return it;
}

// „Bądź w punkcie (x, y), który sam porusza się z prędkością (refVx, refVy)."
// Pilot ekstrapoluje punkt między decyzjami mózgu, więc ruchomy cel nie
// skacze co 50 ms.
export function setFlightArrive(entity, x, y, opts = {}) {
  const it = getFlightIntent(entity);
  const spec = resolveShipFlightSpec(entity);
  it.mode = 'arrive';
  it.x = Number(x) || 0;
  it.y = Number(y) || 0;
  it.refVx = num(opts.refVx, 0);
  it.refVy = num(opts.refVy, 0);
  it.age = 0;
  it.arrival = Math.max(0, num(opts.arrival, 0));
  const limit = num(opts.speedLimit, 0);
  it.speedLimit = limit > 0 ? limit : flightSpeedLimit(spec, opts.speedMode || 'combat');
  const cap = num(opts.approachCap, Infinity);
  it.approachCap = cap > 0 ? cap : 0;
  it.noBrake = !!opts.noBrake;
  it.face = Number.isFinite(opts.face) ? opts.face : NaN;
  it.faceNear = Math.max(0, num(opts.faceNear, it.arrival));
  it.faceFar = Math.max(0, num(opts.faceFar, 0));
  return it;
}

// Hamuj do zera (plus separacja), kadłub w `face` albo tam, gdzie jest.
export function setFlightStop(entity, face = NaN) {
  const it = getFlightIntent(entity);
  const spec = resolveShipFlightSpec(entity);
  it.mode = 'stop';
  it.refVx = 0;
  it.refVy = 0;
  it.age = 0;
  it.speedLimit = flightSpeedLimit(spec, 'combat');
  it.approachCap = Infinity;
  it.noBrake = false;
  it.face = Number.isFinite(face) ? face : NaN;
  it.faceNear = 0;
  it.faceFar = 0;
  return it;
}

export function setFlightSeparation(entity, ax, ay) {
  const it = getFlightIntent(entity);
  it.sepAx = Number(ax) || 0;
  it.sepAy = Number(ay) || 0;
  return it;
}

// Krótki boczny unik (np. przed rakietą) jako poprawka prędkości zadanej.
export function setFlightDodge(entity, vx, vy, duration) {
  const it = getFlightIntent(entity);
  it.dodgeVx = Number(vx) || 0;
  it.dodgeVy = Number(vy) || 0;
  it.dodgeT = Math.max(0, Number(duration) || 0);
  return it;
}

export function setFlightBoost(entity, on) {
  getFlightIntent(entity).boost = !!on;
}

// ---------------------------------------------------------------------------
// Pilot — czyste funkcje (testowalne)
// ---------------------------------------------------------------------------

// Przyspieszenie kątowe, które obraca kadłub do `target` najszybciej, jak
// pozwala spec, i hamuje obrót dokładnie na czas (profil sqrt(2·α·e)).
export function computeFlightTurnAccel(spec, angle, omega, target, dt) {
  const aMax = spec.turnAccel;
  let wDes = 0;
  if (Number.isFinite(target)) {
    const e = wrapFlightAngle(target - angle);
    const ae = Math.abs(e);
    if (ae > 1e-4) {
      const stopW = Math.sqrt(2 * aMax * FLIGHT_PILOT.turnMargin * ae);
      const linW = ae * FLIGHT_PILOT.turnGain;
      wDes = Math.sign(e) * Math.min(spec.turnRate, stopW, linW);
    }
  }
  const gain = Math.min(1 / Math.max(1e-4, dt), FLIGHT_PILOT.omegaGain);
  return clamp((wDes - (Number(omega) || 0)) * gain, -aMax, aMax);
}

// Ogranicza zadane przyspieszenie do możliwości kadłuba:
//  1) składowa przeciwna do bieżącej prędkości to HAMOWANIE (≤ decel, izotropowe),
//  2) reszta idzie w osiach kadłuba: przód ≤ accel, tył ≤ reverseAccel,
//     bok ≤ strafeAccel, na elipsie (skos nie jest darmowy).
export function limitFlightAccel(spec, angle, vx, vy, ax, ay, mul, out) {
  const m = mul > 0 ? mul : 1;
  let bx = 0;
  let by = 0;
  const sp = Math.hypot(vx, vy);
  if (sp > 1e-3) {
    const ux = vx / sp;
    const uy = vy / sp;
    const along = ax * ux + ay * uy;
    if (along < 0) {
      const brake = Math.min(-along, spec.decel * m);
      bx = -ux * brake;
      by = -uy * brake;
      ax -= ux * along;
      ay -= uy * along;
    }
  }
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  let af = ax * c + ay * s;
  let ar = -ax * s + ay * c;
  const limF = (af >= 0 ? spec.accel : spec.reverseAccel) * m;
  const limR = spec.strafeAccel * m;
  const q = (af * af) / (limF * limF) + (ar * ar) / (limR * limR);
  if (q > 1) {
    const k = 1 / Math.sqrt(q);
    af *= k;
    ar *= k;
  }
  out.ax = bx + af * c - ar * s;
  out.ay = by + af * s + ar * c;
  return out;
}

// Kurs kadłuba: daleko od celu — w kierunku lotu (najmocniejszy ciąg jest do
// przodu), blisko — `face` (burta/działa na wroga). Mieszamy wektory, nie kąty,
// a przy przeciwnych kierunkach bierzemy ten bliższy obecnemu kursowi, żeby
// blend nie przerzucał obrotu raz w lewo, raz w prawo.
export function resolveFlightFacing(it, desVx, desVy, dist, angle) {
  const hasFace = Number.isFinite(it.face);
  const moveOk = (desVx * desVx + desVy * desVy) > FLIGHT_PILOT.moveHeadingMinSpeed ** 2;
  if (!moveOk) return hasFace ? it.face : NaN;
  const moveH = Math.atan2(desVy, desVx);
  if (!hasFace) return moveH;
  if (!(it.faceFar > it.faceNear)) return it.face;
  const t0 = clamp((dist - it.faceNear) / (it.faceFar - it.faceNear), 0, 1);
  const t = t0 * t0 * (3 - 2 * t0);
  if (t <= 0) return it.face;
  if (t >= 1) return moveH;
  const bx = (1 - t) * Math.cos(it.face) + t * Math.cos(moveH);
  const by = (1 - t) * Math.sin(it.face) + t * Math.sin(moveH);
  if (bx * bx + by * by < 0.04) {
    const dFace = Math.abs(wrapFlightAngle(it.face - angle));
    const dMove = Math.abs(wrapFlightAngle(moveH - angle));
    return dFace <= dMove ? it.face : moveH;
  }
  return Math.atan2(by, bx);
}

// ---------------------------------------------------------------------------
// Krok lotu (pilot + integrator) — co tick fizyki
// ---------------------------------------------------------------------------

const _acc = { ax: 0, ay: 0 };

export function stepShipFlight(entity, dt) {
  const spec = resolveShipFlightSpec(entity);
  if (!spec) return false;
  const h = clamp(Number(dt) || 0, 0, 0.1);
  if (h <= 0) return false;
  const it = getFlightIntent(entity);

  let x = Number(entity.x) || 0;
  let y = Number(entity.y) || 0;
  let vx = Number(entity.vx);
  let vy = Number(entity.vy);
  if (!Number.isFinite(vx)) vx = 0;
  if (!Number.isFinite(vy)) vy = 0;
  let ang = Number(entity.angle) || 0;
  let om = Number(entity.angVel);
  if (!Number.isFinite(om)) om = 0;

  it.age += h;
  const boost = it.boost === true;
  const accelMul = boost ? FLIGHT_PILOT.boostAccelMul : 1;
  const baseLimit = it.speedLimit > 0 ? it.speedLimit : spec.maxSpeed;
  const cap = Math.min(spec.travelSpeed * (boost ? FLIGHT_PILOT.boostSpeedMul : 1),
    baseLimit * (boost ? FLIGHT_PILOT.boostSpeedMul : 1));

  // --- zadana prędkość ---
  let desVx = 0;
  let desVy = 0;
  let dist = 0;
  if (it.mode === 'arrive') {
    const tx = it.x + it.refVx * it.age;
    const ty = it.y + it.refVy * it.age;
    const dx = tx - x;
    const dy = ty - y;
    dist = Math.hypot(dx, dy);
    const reach = Math.max(0, dist - it.arrival);
    let s;
    if (it.noBrake) {
      s = cap;
    } else {
      const brakeA = spec.decel * accelMul * FLIGHT_PILOT.brakeMargin;
      s = Math.min(Math.sqrt(2 * brakeA * reach), reach * FLIGHT_PILOT.approachGain);
    }
    s = Math.min(s, cap, it.approachCap);
    const inv = dist > 1e-3 ? 1 / dist : 0;
    desVx = it.refVx + dx * inv * s;
    desVy = it.refVy + dy * inv * s;
  }
  // Kurs „w kierunku lotu" liczymy z samej intencji — odpychanie przez sąsiada
  // albo unik nie może obracać kadłuba (stojący szyk kręciłby się w miejscu).
  const moveVx = desVx;
  const moveVy = desVy;
  desVx += it.sepAx * FLIGHT_PILOT.separationHorizon;
  desVy += it.sepAy * FLIGHT_PILOT.separationHorizon;
  if (it.dodgeT > 0) {
    desVx += it.dodgeVx;
    desVy += it.dodgeVy;
    it.dodgeT -= h;
  }
  const desSp = Math.hypot(desVx, desVy);
  if (desSp > cap) {
    const k = cap / desSp;
    desVx *= k;
    desVy *= k;
  }
  // Cofanie (ruch rufą naprzód) ma własny, niższy limit — okręt, który chce
  // szybko do tyłu, musi się najpierw obrócić.
  const hfx = Math.cos(ang);
  const hfy = Math.sin(ang);
  const backDes = -(desVx * hfx + desVy * hfy);
  if (backDes > spec.reverseSpeed) {
    const excess = backDes - spec.reverseSpeed;
    desVx += hfx * excess;
    desVy += hfy * excess;
  }

  // --- przyspieszenie w granicach specyfikacji ---
  const tau = FLIGHT_PILOT.velocityTau;
  limitFlightAccel(spec, ang, vx, vy, (desVx - vx) / tau, (desVy - vy) / tau, accelMul, _acc);
  const ax = _acc.ax;
  const ay = _acc.ay;

  // --- kurs ---
  const face = resolveFlightFacing(it, moveVx, moveVy, dist, ang);
  const alpha = computeFlightTurnAccel(spec, ang, om, face, h);

  // --- integracja ---
  vx += ax * h;
  vy += ay * h;
  const sp = Math.hypot(vx, vy);
  if (sp > cap) {
    const next = Math.max(cap, sp - spec.decel * FLIGHT_PILOT.governorDecelFrac * h);
    const k = next / sp;
    vx *= k;
    vy *= k;
  }
  const backV = -(vx * hfx + vy * hfy);
  if (backV > spec.reverseSpeed) {
    const cut = Math.min(backV - spec.reverseSpeed, spec.decel * FLIGHT_PILOT.governorDecelFrac * h);
    vx += hfx * cut;
    vy += hfy * cut;
  }
  om += alpha * h;
  const aom = Math.abs(om);
  if (aom > spec.turnRate) {
    om = Math.sign(om) * Math.max(spec.turnRate, aom - spec.turnAccel * h);
  }
  ang = wrapFlightAngle(ang + om * h);
  x += vx * h;
  y += vy * h;

  entity.x = x;
  entity.y = y;
  entity.vx = vx;
  entity.vy = vy;
  if (entity.pos) { entity.pos.x = x; entity.pos.y = y; }
  if (entity.vel) { entity.vel.x = vx; entity.vel.y = vy; }
  entity.angle = ang;
  entity.angVel = om;
  entity.desiredAngle = Number.isFinite(face) ? face : ang;

  entity.__flightVfxT = (Number(entity.__flightVfxT) || 0) + h;
  if (entity.__flightVfxT >= FLIGHT_PILOT.vfxInterval) {
    syncFlightThrusterVisuals(entity, spec, ax, ay, alpha, ang, entity.__flightVfxT);
    entity.__flightVfxT = 0;
  }
  return true;
}

// Stan dysz dla VFX wyliczony z faktycznie użytego przyspieszenia. Siły z dysz
// NIE wracają do fizyki — to czysto wizualne.
function syncFlightThrusterVisuals(entity, spec, ax, ay, alpha, ang, dtAcc) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const af = ax * c + ay * s;
  const ar = -ax * s + ay * c;
  const main = af > 0 ? clamp(af / spec.accel, 0, 1) : 0;
  const retro = af < 0 ? clamp(-af / Math.max(spec.reverseAccel, spec.decel * 0.6), 0, 1) : 0;
  const lat = clamp(ar / spec.strafeAccel, -1, 1);
  const torque = clamp(alpha / spec.turnAccel, -1, 1);
  const ti = entity.thrusterInput || (entity.thrusterInput = { main: 0, leftSide: 0, rightSide: 0, retro: 0, torque: 0 });
  ti.main = main;
  ti.retro = retro;
  ti.leftSide = lat > 0 ? lat : 0;
  ti.rightSide = lat < 0 ? -lat : 0;
  ti.torque = torque;
  const input = entity.input || (entity.input = { thrustX: 0, thrustY: 0, aimX: 0, aimY: 0 });
  input.thrustY = main >= retro ? main : -retro;
  const visual = entity.visual;
  if (visual && ((visual.mainThrusters && visual.mainThrusters.length) || (visual.torqueThrusters && visual.torqueThrusters.length))) {
    composeShipThrusterCommand(entity, null);
    updateShipThrusterState(entity, dtAcc);
  }
}
