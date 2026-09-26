// Nośnik prędkości (src/game/carrierVelocity.js) i zegar symulacji
// (src/game/simClock.js): pociski i efekty dziedziczą 100% prędkości kadłuba,
// z którego wyszły, a efekty rysują się w  pos + v · (T − t0)  z czasu gry.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { SimClock, CLOCK_RENDER, CLOCK_SIM } from '../src/game/simClock.js';
import {
  ActiveCarrier,
  createCarrier,
  writeCarrier,
  writeCarrierVelocity,
  writePointVelocity,
  isInterpolatedEntity
} from '../src/game/carrierVelocity.js';
import { stepProjectileKinematics } from '../src/game/projectileTrajectory.js';

const close = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} != ${b}`);

test('prędkość punktu kadłuba = ruch środka + obrót (v + ω × r), NPC, gracz i proxy', () => {
  const out = { x: 0, y: 0 };
  const npc = { x: 100, y: 0, vx: 10, vy: 0, angVel: 2 };
  writePointVelocity(npc, 100, 50, out);         // r = (0, 50): ω×r = (−100, 0)
  close(out.x, -90); close(out.y, 0);

  const player = { pos: { x: 0, y: 0 }, vel: { x: 5, y: 6 }, angVel: 0.5 };
  writePointVelocity(player, 10, 0, out);         // r = (10, 0): ω×r = (0, 5)
  close(out.x, 5); close(out.y, 11);

  writePointVelocity({ _realEntity: npc }, 100, 50, out);
  close(out.x, -90, 1e-9, 'proxy trafień');

  writePointVelocity({ x: 0, y: 0 }, 5, 5, out);
  assert.deepEqual([out.x, out.y], [0, 0], 'encja bez prędkości stoi');
});

test('SimClock: czas pokazywany w klatce = poza interpolowana gracza, w pauzie = fizyczna', () => {
  SimClock.reset();
  SimClock.advance(1 / 120);
  SimClock.advance(1 / 120);
  SimClock.beginRender(0.25, 1 / 120);
  close(SimClock.render, 2 / 120 - 0.75 / 120, 1e-12);
  close(SimClock.renderSim, 2 / 120, 1e-12);
  SimClock.beginRender(0.25, 1 / 120, true);
  close(SimClock.render, SimClock.sim, 1e-12, 'pauza');
  SimClock.advance(-1);
  close(SimClock.sim, 2 / 120, 1e-12, 'ujemny krok nie cofa zegara');
});

test('writeCarrier: gracz na zegarze renderu, NPC na zegarze fizyki; czas pozy wg źródła pozycji', () => {
  const prevWindow = globalThis.window;
  const player = { pos: { x: 0, y: 0 }, vel: { x: 1000, y: 0 }, angVel: 0 };
  const npc = { x: 0, y: 0, vx: 0, vy: 500 };
  globalThis.window = { ship: player, player2Ship: null };
  try {
    SimClock.reset();
    SimClock.advance(1);
    SimClock.beginRender(0.5, 0.2);            // render = 0.9, renderSim = 1
    SimClock.advance(0.2);                      // krok fizyki po renderze: sim = 1.2

    assert.equal(isInterpolatedEntity(player), true);
    const c = createCarrier();
    writeCarrier(player, 0, 0, true, c);
    assert.equal(c.clock, CLOCK_RENDER);
    close(c.t0, 0.9, 1e-12, 'rekord Turret2D gracza = poza z ostatniego renderu');
    close(c.vx, 1000);

    writeCarrier(player, 0, 0, false, c);
    close(c.t0, 1.2, 1e-12, 'poza fizyczna = bieżący sim');

    writeCarrier(npc, 0, 0, true, c);
    assert.equal(c.clock, CLOCK_SIM);
    close(c.t0, 1, 1e-12, 'rekord Turret2D NPC = sim z ostatniego renderu');
    close(c.vy, 500);

    writeCarrierVelocity(3, 4, CLOCK_RENDER, 7, c);
    assert.deepEqual([c.vx, c.vy, c.clock, c.t0], [3, 4, CLOCK_RENDER, 7]);

    ActiveCarrier.set(c);
    assert.deepEqual([ActiveCarrier.vx, ActiveCarrier.vy, ActiveCarrier.clock, ActiveCarrier.t0], [3, 4, CLOCK_RENDER, 7]);
    ActiveCarrier.clear();
    assert.deepEqual([ActiveCarrier.vx, ActiveCarrier.vy], [0, 0]);
  } finally {
    globalThis.window = prevWindow;
    SimClock.reset();
  }
});

test('getLeadAim: pocisk dziedziczy prędkość strzelca, więc liczy się ruch WZGLĘDNY', async () => {
  globalThis.window = globalThis.window ?? {};
  const { getLeadAim } = await import('../src/ai/aiUtils.js');
  const target = { x: 3000, y: 0, vx: 8000, vy: 0 };
  // Strzelec leci razem z celem: cel stoi względem niego — celujemy prosto w niego.
  const same = getLeadAim({ x: 0, y: 0 }, target, 2500, { x: 0, y: 0 }, { x: 8000, y: 0 });
  close(same.x, 3000, 1e-6); close(same.y, 0, 1e-6);

  // Strzelec w spoczynku (bez shooterVel): dawna formuła.
  const crossing = { x: 3000, y: 0, vx: 0, vy: 500 };
  const rest = getLeadAim({ x: 0, y: 0 }, crossing, 2500, { x: 0, y: 0 });
  assert.ok(rest.y > 0, 'wyprzedzenie w stronę ruchu celu');

  // Symulacja: pocisk z pędzącego okrętu (100% dziedziczenia) trafia cel lecący w bok.
  const shooterVel = { x: 6000, y: 0 };
  const moving = { x: 4000, y: 0, vx: 6000, vy: 700 };
  const aim = getLeadAim({ x: 0, y: 0 }, moving, 2500, { x: 0, y: 0 }, shooterVel);
  const len = Math.hypot(aim.x, aim.y);
  const bvx = aim.x / len * 2500 + shooterVel.x;
  const bvy = aim.y / len * 2500 + shooterVel.y;
  let best = Infinity;
  for (let t = 0; t < 3; t += 1 / 240) {
    best = Math.min(best, Math.hypot(bvx * t - (moving.x + moving.vx * t), bvy * t - (moving.y + moving.vy * t)));
  }
  assert.ok(best < 5, `pocisk mija cel o ${best.toFixed(1)} j.`);
});

test('stepProjectileKinematics: pocisk z pozy PO całkowaniu kroku czeka na następny krok', () => {
  const dt = 1 / 120;
  const born = { x: 0, y: 0, vx: 12000, vy: 0, life: 1, bornSim: 5 };
  stepProjectileKinematics(born, dt, 5);
  assert.deepEqual([born.x, born.px], [0, 0], 'bez przesunięcia w kroku narodzin');
  close(born.life, 1, 1e-12, 'zasięg nie ubywa');

  stepProjectileKinematics(born, dt, 5 + dt);
  close(born.x, 12000 * dt, 1e-9, 'kolejny krok — pełny');

  const early = { x: 0, y: 0, vx: 1000, vy: 0, life: 1, bornSim: 5 - dt };
  stepProjectileKinematics(early, dt, 5);
  close(early.x, 1000 * dt, 1e-9, 'strzał z pozy sprzed kroku leci od razu');

  const legacy = { x: 0, y: 0, vx: 1000, vy: 0, life: 1 };
  stepProjectileKinematics(legacy, dt, 5);
  close(legacy.x, 1000 * dt, 1e-9, 'pocisk bez bornSim jak dawniej');
});

// --- Bank Fx3D: cząstka jedzie z nośnikiem, opór działa na ruch własny ---

function stubCanvasDom() {
  const ctx2d = new Proxy({}, {
    get(target, key) {
      if (key === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (key in target) return target[key];
      return () => {};
    },
    set(target, key, value) { target[key] = value; return true; }
  });
  globalThis.document = globalThis.document ?? {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d })
  };
}

test('Fx3D: dym z lufy leci z okrętem (nośnik), a opór hamuje tylko jego ruch własny', async () => {
  stubCanvasDom();
  const { Core3D } = await import('../src/3d/core3d.js');
  const { Fx3D, sp } = await import('../src/3d/fxParticles3D.js');
  Core3D.isInitialized = true;
  Core3D.scene = new THREE.Scene();
  try {
    assert.ok(Fx3D.ensure(), 'bank powstał');
    SimClock.reset();
    // Okręt 10 000 j/s w +x świata, cząstka bez ruchu własnego.
    Fx3D.setCarrier({ vx: 10000, vy: 0, t0: 0, clock: CLOCK_SIM });
    const o = sp();
    o.x = 0; o.y = 0; o.z = 15; o.life = 5; o.drag = 1.15;
    Fx3D.smoke.spawn(o);
    Fx3D.clearCarrier();
    // Bez nośnika — jak dawniej (stoi w świecie).
    const still = sp();
    still.x = 0; still.y = 0; still.z = 15; still.life = 5; still.drag = 1.15;
    Fx3D.smoke.spawn(still);

    SimClock.advance(0.5);
    SimClock.beginRender(1, 0.5);
    Fx3D.update(0.05);
    const P = Fx3D.smoke.bufs.iPos.array;
    close(P[0], 5000, 1e-6, 'dym przesunięty z okrętem o v·(T − t0)');
    close(P[3], 0, 1e-6, 'efekt bez nośnika stoi');
  } finally {
    Fx3D.reset();
    Core3D.isInitialized = false;
    Core3D.scene = null;
    SimClock.reset();
  }
});
