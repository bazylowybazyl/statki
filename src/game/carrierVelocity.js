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

// Pozy renderu NPC i wraków (src/game/renderPoses.js — tryby z migawką): byt w pozie interpolowanej między krokami
// stoi w obrazie w czasie SimClock.render, jak gracz. Hak gry (index.html `npcRenderPosed`) albo null (off, ?npcLerp=0).
let _renderPosed = null;
let _renderPosedWorld = false;
/** `fn(byt)` — byt w pozie renderu; `world` — pozy renderu włączone (świat w obrazie w czasie SimClock.render). */
export function setRenderPosedEntity(fn, world = false) {
  _renderPosed = typeof fn === 'function' ? fn : null;
  _renderPosedWorld = _renderPosed !== null && !!world;
}

/**
 * Zegar OBRAZU efektu i pocisku encji (2026-10-28, zgłoszenie „240 kl/s, a pociski, trafienia i strzały klatkują”):
 * CLOCK_RENDER, gdy encja jest w obrazie w pozie renderu — gracz, P2, NPC i wraki z pozą renderu. Pociski i efekty NPC
 * szły zegarem kroku (CLOCK_SIM) obok kadłuba interpolowanego do 240 Hz: stały 3 klatki i skakały o v/60, przed
 * kadłubem. Tylko obraz — rozgrywka pyta `isInterpolatedEntity` (gracz rusza się w kroku przed rakietami).
 */
export function isRenderClockEntity(entity) {
  if (isInterpolatedEntity(entity)) return true;
  const e = unwrap(entity);
  return !!(e && _renderPosed !== null && _renderPosed(e));
}

/**
 * Zegar OBRAZU pocisku: przy pozach renderu (`setRenderPosedEntity(fn, true)`) każdy pocisk na zegarze renderu — jego lot
 * nie zależy od ruchu strzelca, a nieruchomy strzelec (okręt w stanowisku, platforma) nie ma „żywej” pozy renderu i jego
 * pocisk szedłby krokiem 60 Hz; do chwili wystrzału pocisk jedzie z lufą (WeaponFx.sync). Bez póz renderu — zegar strzelca.
 */
export function projectileClockOf(shooter) {
  return _renderPosedWorld || isRenderClockEntity(shooter) ? CLOCK_RENDER : CLOCK_SIM;
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
  const interpolated = isRenderClockEntity(e);
  out.clock = interpolated ? CLOCK_RENDER : CLOCK_SIM;
  out.t0 = fromRender
    ? (interpolated ? SimClock.render : SimClock.renderSim)
    : SimClock.sim;
  out.z = entityRenderZ(e);
  return out;
}

/**
 * Gra 3D: wysokość encji do rysunku efektów (z = 0 — płaszczyzna gry). Gracz — z interpolacji
 * renderu (window.__interpShipPose.z), reszta — z encji.
 */
export function entityRenderZ(entity) {
  const e = unwrap(entity);
  if (!e) return 0;
  if (typeof window !== 'undefined' && e === window.ship) {
    const z = window.__interpShipPose?.z;
    if (Number.isFinite(z)) return z;
  }
  const z = Number(e.z);
  return Number.isFinite(z) ? z : 0;
}

/** Nośnik o znanej prędkości (np. prędkość odziedziczona przez pocisk). */
export function writeCarrierVelocity(vx, vy, clock, t0, out) {
  out.x = out.vx = finite(vx);
  out.y = out.vy = finite(vy);
  out.clock = clock === CLOCK_RENDER ? CLOCK_RENDER : CLOCK_SIM;
  out.t0 = Number.isFinite(t0) ? t0 : SimClock.sim;
  out.z = 0;
  return out;
}

export function clearCarrier(out) {
  out.x = out.y = out.vx = out.vy = 0;
  out.z = 0;
  out.clock = CLOCK_SIM;
  out.t0 = SimClock.sim;
  return out;
}

export function createCarrier() {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, clock: CLOCK_SIM, t0: 0 };
}

/**
 * Nośnik BIEŻĄCEJ serii spawnów. Czytają go przy narodzinach cząstek wszystkie
 * systemy efektów (Fx3D, CanvasVFX, SparkSystem3D, overlay 3D, pule broni WeaponFx),
 * więc wołający ustawia go raz tuż przed serią (błysk, trafienie) i zdejmuje
 * tuż po niej — bez wołania w środku innych emiterów. Zdjęty = zero, czyli
 * efekt stoi w świecie jak dawniej (np. iskry dysz).
 */
export const ActiveCarrier = {
  vx: 0,
  vy: 0,
  t0: 0,
  // Gra 3D: wysokość nośnika — pule efektów (weapons/gpuFx.js) rodzą paczki na z = 15 + z.
  z: 0,
  clock: CLOCK_SIM,
  set(carrier) {
    this.vx = finite(carrier?.vx);
    this.vy = finite(carrier?.vy);
    this.t0 = finite(carrier?.t0);
    this.z = finite(carrier?.z);
    this.clock = carrier?.clock === CLOCK_RENDER ? CLOCK_RENDER : CLOCK_SIM;
    return this;
  },
  clear() {
    this.vx = 0;
    this.vy = 0;
    this.t0 = 0;
    this.z = 0;
    this.clock = CLOCK_SIM;
    return this;
  }
};

if (typeof window !== 'undefined') window.ActiveCarrier = ActiveCarrier;

/** Czas lotu z nośnikiem na tę klatkę: T − t0 (przesunięcie = v · wynik). */
export function carrierElapsed(clock, t0) {
  return SimClock.now(clock) - t0;
}
