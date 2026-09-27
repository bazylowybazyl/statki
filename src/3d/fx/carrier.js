// src/3d/fx/carrier.js
//
// NOŚNIK W PACZKACH CZĄSTEK GPU (agents.md § Nośnik prędkości, PROJEKT-BRONI §0.3).
//
// Efekt rodzi się z prędkością kadłuba, z którego wyszedł (100% — w próżni nic go nie
// hamuje), i rysuje się w
//     p(T) = p_własne(t) + v_c · (T_zegar − t0),
// gdzie p_własne(t) to ruch WŁASNY cząstki (prędkość receptury, opór, turbulencja —
// liczony w układzie nośnika), v_c — prędkość nośnika (stała od narodzin), t0 — czas
// pozy, z której efekt wystartował, a T_zegar — czas pokazywany w klatce przez zegar
// nośnika (SimClock: `render` dla encji interpolowanych — gracz, P2 — i `sim` dla
// reszty). Opór działa tylko na ruch własny: dym z lufy Atlasa przy 10 000 j/s wygląda
// jak przy postoju. Wzór z Fx3D (src/3d/fxParticles3D.js, `carrierElapsed`) i smug
// (src/3d/slugTrail3D.js) — tu dla pul GPU z dem.
//
// Pule dema broni dodawały `vel` paczki do prędkości WŁASNEJ (`v = d·speed + vel`),
// a kernele tłumiły całe v — dym z pędzącego okrętu zostawał w tyle. Dlatego nośnik
// jest OSOBNYM członem paczki (BSTRIDE 12 → 13 w gpuFx, zadanie 17):
//     vec4 nośnika = (vx, vy — układ sceny, t0 − epoka zegara gry, zegar 0 | 1),
// a spawn kopiuje go do stanu cząstki (bez przeliczeń). Czasy względem epoki
// `FxPoolOrigin.simEpoch` (float32: czas gry rośnie godzinami), przesuwane kernelem
// przy przeskoku epoki (`createShiftKernel(..., simTime: [[k, 'z']])`).

import { Fn, float, vec2, select, exp, max } from 'three/tsl';
import { ActiveCarrier } from '../../game/carrierVelocity.js';
import { CLOCK_RENDER, CLOCK_SIM } from '../../game/simClock.js';

/** Liczb (float32) na nośnik w paczce / stanie cząstki. */
export const CARRIER_FLOATS = 4;

/**
 * Zapisuje nośnik do tablicy paczki od `offset`: (vx, −vy świata → scena, t0 − simEpoch,
 * zegar). `carrier` = obiekt z polami { vx, vy, t0, clock } (domyślnie ActiveCarrier
 * ustawiony przez fasadę efektu tuż przed recepturą). Bez prędkości t0 = 0 (człon i tak
 * zerowy — bez dużej liczby we float32).
 */
export function writeCarrierPacket(out, offset, simEpoch = 0, carrier = ActiveCarrier) {
  const vx = Number(carrier?.vx) || 0;
  const vy = Number(carrier?.vy) || 0;
  const moving = vx !== 0 || vy !== 0;
  out[offset] = vx;
  out[offset + 1] = -vy;
  out[offset + 2] = moving ? (Number(carrier?.t0) || 0) - simEpoch : 0;
  out[offset + 3] = moving && carrier?.clock === CLOCK_RENDER ? CLOCK_RENDER : CLOCK_SIM;
  return out;
}

/** Zeruje nośnik paczki (efekt stoi w świecie — np. iskry dysz). */
export function clearCarrierPacket(out, offset) {
  out[offset] = 0;
  out[offset + 1] = 0;
  out[offset + 2] = 0;
  out[offset + 3] = CLOCK_SIM;
  return out;
}

/** CPU: czas lotu z nośnikiem (T_zegar − t0) dla pól paczki; czasy względem epoki. */
export function carrierElapsedCpu(clock, t0, timeSim, timeRender) {
  return (clock > 0.5 ? timeRender : timeSim) - t0;
}

/**
 * CPU: droga ruchu z oporem liniowym po czasie t przy prędkości początkowej 1
 * (lustro `dragPath` z dema broni: (1 − e^(−d·t)) / d, bez oporu — t).
 */
export function dragPathCpu(drag, t) {
  return drag > 1e-4 ? (1 - Math.exp(-drag * t)) / Math.max(drag, 1e-4) : t;
}

/**
 * LUSTRO CPU wzoru nośnika (test): pozycja cząstki (układ lokalny sceny) w chwili
 * rysowania. p0 — narodziny (lokalne), v — prędkość WŁASNA, drag — opór ruchu
 * własnego, age — wiek cząstki [s zegara efektów], packet[offset..+3] — nośnik,
 * timeSim / timeRender — zegary gry względem epoki. Wynik w `out` ({ x, y }).
 */
export function carrierPositionCpu(out, p0x, p0y, vx, vy, drag, age, packet, offset, timeSim, timeRender) {
  const own = dragPathCpu(drag, age);
  const e = carrierElapsedCpu(packet[offset + 3], packet[offset + 2], timeSim, timeRender);
  out.x = p0x + vx * own + packet[offset] * e;
  out.y = p0y + vy * own + packet[offset + 1] * e;
  return out;
}

/**
 * TSL: przesunięcie z nośnika v_c · (T_zegar − t0) (vec2, układ sceny) dla vec4 nośnika
 * (vx, vy, t0, zegar) i zegarów gry względem epoki (`FxPoolOrigin.timeSim` /
 * `.timeRender`). Czysta funkcja z layoutem — uniformy wchodzą parametrami (błąd r183:
 * uniform w domknięciu funkcji z `setLayout` czyta slot pierwszego materiału).
 */
export const fxCarrierOffset = /*@__PURE__*/ Fn(([carrier, timeSim, timeRender]) => {
  const T = select(carrier.w.greaterThan(0.5), timeRender, timeSim);
  return carrier.xy.mul(T.sub(carrier.z));
}).setLayout({
  name: 'fxCarrierOffset',
  type: 'vec2',
  inputs: [
    { name: 'carrier', type: 'vec4' },
    { name: 'timeSim', type: 'float' },
    { name: 'timeRender', type: 'float' }
  ]
});

/**
 * TSL: droga z oporem liniowym (lustro `dragPathCpu`) — ruch własny cząstki analitycznie.
 */
export const fxDragPath = /*@__PURE__*/ Fn(([drag, t]) => {
  return select(drag.greaterThan(1e-4), float(1.0).sub(exp(drag.negate().mul(t))).div(max(drag, 1e-4)), t);
}).setLayout({
  name: 'fxDragPath',
  type: 'float',
  inputs: [
    { name: 'drag', type: 'float' },
    { name: 'age', type: 'float' }
  ]
});

/** TSL: pozycja cząstki = p0 + v·drogaWłasna + przesunięcie nośnika (vec2). */
export function fxCarriedPosition(p0, v, drag, age, carrier, timeSim, timeRender) {
  return vec2(p0).add(vec2(v).mul(fxDragPath(drag, age))).add(fxCarrierOffset(carrier, timeSim, timeRender));
}
