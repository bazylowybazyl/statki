// dema/warp-webgpu/freeWorld.js
//
// Świat lotu swobodnego (scena 5): start nad Ziemią z kursem na Jowisza,
// w warpie ciała w soczewce świata (bez celu — widać to, obok czego lecimy).
// Prawdziwa prędkość w warpie = widoczny przepływ × TRUE_PER_FLOW (setki tys. j/s);
// soczewka włącza się przy skoku (0,5 s) i gaśnie gwałtownie przy wyjściu (0,3 s).

import { buildTrip } from './solar.js';

const TRUE_PER_FLOW = 18;

export function createFreeWorld(ctx) {
  const w = { ship: { x: 0, y: 0 }, heading: 0, speed: 0, beta: 0, bodyZoom: 1, target: null, time: 0 };
  let trip = null;
  let beta = 0;
  let trueSpeed = 0;
  return {
    get startAngle() { return trip ? trip.heading : 0; },
    get zoom0() { return trip ? trip.zoom0 : 0.14; },
    get trueSpeed() { return trueSpeed; },
    get trip() { return trip; },
    reset() {
      trip = buildTrip(ctx.system, 'earth', 'jupiter', ctx.viewW, ctx.viewH, ctx.focal());
      w.ship.x = trip.P0.x;
      w.ship.y = trip.P0.y;
      beta = 0;
      trueSpeed = 0;
    },
    tick(t, dt, st) {
      const warp = st.mode === 'warp';
      const exiting = st.mode === 'exit';
      if (warp) beta = Math.min(1, beta + dt / 0.5);
      else beta = Math.max(0, beta - dt / (exiting ? 0.3 : 0.6));
      trueSpeed = warp || exiting ? Math.max(st.speed, 0) * TRUE_PER_FLOW : st.speed;
      w.ship.x += Math.cos(st.angle) * trueSpeed * dt;
      w.ship.y += Math.sin(st.angle) * trueSpeed * dt;
      w.time = t;
    },
    state(t, st) {
      w.heading = st.angle;
      w.speed = Math.max(trueSpeed, 1);
      w.beta = beta;
      w.bodyZoom = 1;
      w.target = null;
      w.time = t;
      return w;
    }
  };
}
