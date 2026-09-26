// src/game/carrierVelocity.js
//
// Prędkość NOŚNIKA: ile ruchu dostaje w chwili narodzin pocisk albo efekt.
// W próżni nic go potem nie hamuje, więc wystrzał, dym z lufy i iskry trafienia
// lecą dalej z prędkością kadłuba, z którego wyszły (100%, jak u Galileusza).
//
// Punkt na obracającym się kadłubie ma prędkość v + ω × r — wieżyczka 900 j.
// od środka Atlasa przy 0,55 rad/s dostaje ~500 j/s z samego obrotu.
//
// Konwencje encji w grze: gracz (pos, vel, angVel), NPC i wraki (x, y, vx, vy,
// angVel), proxy trafień gracza (`_realEntity`). Brak pola = 0.

import { SimClock, CLOCK_RENDER, CLOCK_SIM } from './simClock.js';

const finite = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

function unwrap(entity) {
  return entity?._realEntity || entity || null;
}

/** Czy encja jest rysowana w pozie interpolowanej (gracz, P2) — patrz simClock.js. */
export function isInterpolatedEntity(entity) {
  const e = unwrap(entity);
  if (!e || typeof window === 'undefined') return false;
  return e === window.ship || e === window.player2Ship;
}

/** Prędkość środka encji (świat gry). */
export function writeEntityVelocity(entity, out) {
  const e = unwrap(entity);
  out.x = finite(e?.vel?.x ?? e?.vx);
  out.y = finite(e?.vel?.y ?? e?.vy);
  return out;
}

/** Prędkość punktu (x, y) sztywno związanego z encją: v + ω × r. */
export function writePointVelocity(entity, x, y, out) {
  const e = unwrap(entity);
  writeEntityVelocity(e, out);
  const w = finite(e?.angVel);
  if (w !== 0) {
    const cx = finite(e?.pos?.x ?? e?.x);
    const cy = finite(e?.pos?.y ?? e?.y);
    out.x -= w * (finite(y) - cy);
    out.y += w * (finite(x) - cx);
  }
  return out;
}

/**
 * Nośnik efektu urodzonego w punkcie (x, y) encji: prędkość, czas pozy i zegar.
 * `fromRender` — pozycja pochodzi z rekordów ostatniej klatki renderu (Turret2D),
 * a nie z pozy fizycznej bieżącego kroku.
 */
export function writeCarrier(entity, x, y, fromRender, out) {
  const e = unwrap(entity);
  if (!e) return clearCarrier(out);
  writePointVelocity(e, x, y, out);
  out.vx = out.x;
  out.vy = out.y;
  const interpolated = isInterpolatedEntity(e);
  out.clock = interpolated ? CLOCK_RENDER : CLOCK_SIM;
  out.t0 = fromRender
    ? (interpolated ? SimClock.render : SimClock.renderSim)
    : SimClock.sim;
  return out;
}

/** Nośnik o znanej prędkości (np. prędkość odziedziczona przez pocisk). */
export function writeCarrierVelocity(vx, vy, clock, t0, out) {
  out.x = out.vx = finite(vx);
  out.y = out.vy = finite(vy);
  out.clock = clock === CLOCK_RENDER ? CLOCK_RENDER : CLOCK_SIM;
  out.t0 = Number.isFinite(t0) ? t0 : SimClock.sim;
  return out;
}

export function clearCarrier(out) {
  out.x = out.y = out.vx = out.vy = 0;
  out.clock = CLOCK_SIM;
  out.t0 = SimClock.sim;
  return out;
}

export function createCarrier() {
  return { x: 0, y: 0, vx: 0, vy: 0, clock: CLOCK_SIM, t0: 0 };
}

/**
 * Nośnik BIEŻĄCEJ serii spawnów. Czytają go przy narodzinach cząstek wszystkie
 * systemy efektów (Fx3D, CanvasVFX, SparkSystem3D, overlay 3D, FlakBurstVFX),
 * więc wołający ustawia go raz tuż przed serią (błysk, trafienie) i zdejmuje
 * tuż po niej — bez wołania w środku innych emiterów. Zdjęty = zero, czyli
 * efekt stoi w świecie jak dawniej (np. iskry dysz).
 */
export const ActiveCarrier = {
  vx: 0,
  vy: 0,
  t0: 0,
  clock: CLOCK_SIM,
  set(carrier) {
    this.vx = finite(carrier?.vx);
    this.vy = finite(carrier?.vy);
    this.t0 = finite(carrier?.t0);
    this.clock = carrier?.clock === CLOCK_RENDER ? CLOCK_RENDER : CLOCK_SIM;
    return this;
  },
  clear() {
    this.vx = 0;
    this.vy = 0;
    this.t0 = 0;
    this.clock = CLOCK_SIM;
    return this;
  }
};

if (typeof window !== 'undefined') window.ActiveCarrier = ActiveCarrier;

/** Czas lotu z nośnikiem na tę klatkę: T − t0 (przesunięcie = v · wynik). */
export function carrierElapsed(clock, t0) {
  return SimClock.now(clock) - t0;
}
