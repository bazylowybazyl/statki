// Render kontenerów i dronów (Z5) po stronie CPU: dane instancji względem
// początku przy kamerze, pozy slotów, LOD, limity i budżet wywołań.
// node --test tests/cargoContainers3D.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { CARGO3D_LIMITS, CARGO3D_TUNE, CargoContainers3D, buildContainerGeometry } from '../src/3d/cargoContainers3D.js';
import { CargoDrones3D, buildDroneGeometry, pushCargoScene } from '../src/3d/cargoDrones3D.js';
import { cargoDeckFill, cargoHoldSlots, cargoLayoutScale } from '../src/data/cargoContainers.js';
import {
  CARGO_DRONE,
  CARGO_DRONE_STRIDE,
  CARGO_MODE,
  cargoBerthGeometry,
  cargoHullExtent,
  cargoTransferWindow,
  planCargoTransfer,
  transferState
} from '../src/game/cargoPortOps.js';
import { createBayLayout } from '../src/3d/haloRing/haloPortBays.js';

const scene = new THREE.Scene();
CargoContainers3D.attach(scene);
CargoDrones3D.attach(scene);

const FAR = { x: 6_400_000, y: -3_100_000 };
function frame(opts = {}) {
  CargoContainers3D.begin({
    camera: { x: FAR.x, y: FAR.y, zoom: opts.zoom ?? 1.5 },
    cameraHeight: opts.perspective ? undefined : (opts.H ?? 1100),
    perspective: !!opts.perspective,
    pxPerUnit: opts.zoom ?? 1.5,
    viewHalfW: opts.viewHalf ?? 2000,
    viewHalfH: opts.viewHalf ?? 2000,
    sun: { x: FAR.x - 900000, y: FAR.y + 300000 },
    portSun: { dir: [0.4, 0.2, 0.75], daylight: 1 },
    time: 3
  });
  CargoDrones3D.begin({});
}

test('geometrie: sfazowany kontener bez dna, dron z ukośnymi ramionami; indeksy w zakresie', () => {
  const g = buildContainerGeometry();
  assert.equal(g.position.length / 3, 36);
  assert.ok(Math.max(...g.index) < g.position.length / 3);
  assert.ok([...g.normal].every((v) => Number.isFinite(v)));
  const d = buildDroneGeometry();
  assert.ok(d.position.length / 3 < 65535 && Math.max(...d.index) < d.position.length / 3);
  assert.equal(d.part.length, d.position.length / 3);
});

test('pokład statku: kontenery w slotach (świat gry → scena), dane małe przy świecie 6 mln j.', () => {
  frame();
  const pose = { x: FAR.x + 120, y: FAR.y - 40, angle: 0.7 };
  const fill = cargoDeckFill('container_ship', { chips: 160 }, 160);
  const n = CargoContainers3D.pushShipDeck(pose, 'container_ship', fill.slots, 42);
  CargoContainers3D.end();
  assert.equal(n, fill.count);
  const slots = cargoHoldSlots('container_ship');
  const s = cargoLayoutScale('container_ship');
  const P = CargoContainers3D.attrs.pos.array;
  const F = CargoContainers3D.frame;
  const mesh = CargoContainers3D.mesh;
  assert.equal(mesh.position.x, F.originX);
  let k = 0;
  for (let i = 0; i < slots.length; i++) {
    if (fill.slots[i] < 0) continue;
    const lx = slots[i].x * s;
    const ly = slots[i].y * s;
    const gx = pose.x + lx * Math.cos(pose.angle) - ly * Math.sin(pose.angle);
    const gy = pose.y + lx * Math.sin(pose.angle) + ly * Math.cos(pose.angle);
    assert.ok(Math.abs(P[k * 4] + F.originX - gx) < 1e-3, `slot ${i}: x`);
    assert.ok(Math.abs(P[k * 4 + 1] + F.originY + gy) < 1e-3, `slot ${i}: y (scena = −y gry)`);
    assert.ok(Math.abs(P[k * 4]) < 1000 && Math.abs(P[k * 4 + 1]) < 1000, 'dane względem początku przy kamerze');
    assert.ok(Math.abs(P[k * 4 + 3] + pose.angle) < 1e-6, 'kurs sceny = −kąt gry');
    k++;
  }
  assert.ok(CargoContainers3D.stats.hullShadows > 0, 'cienie na kadłubie');
  assert.equal(CargoContainers3D.stats.deckShadows, 0, 'pokład statku nie rzuca na pokład portu');
});

test('LOD i kadrowanie: znikają poniżej kilku px, poza kadrem nic, cienie dopiero od ~10 px', () => {
  const fill = cargoDeckFill('long_haul_freighter', { iron_ore: 380 }, 380);
  const pose = { x: FAR.x, y: FAR.y, angle: 0 };
  frame({ zoom: 0.05 });
  CargoContainers3D.pushShipDeck(pose, 'long_haul_freighter', fill.slots, 1);
  CargoContainers3D.end();
  assert.equal(CargoContainers3D.stats.instances, 0, 'zoom 0,05: kontenery ~0,5 px');
  frame({ zoom: 0.5 });
  CargoContainers3D.pushShipDeck(pose, 'long_haul_freighter', fill.slots, 1);
  CargoContainers3D.end();
  assert.equal(CargoContainers3D.stats.instances, fill.count);
  assert.equal(CargoContainers3D.stats.hullShadows, 0, 'zoom 0,5: ~5 px — bez cieni');
  frame({ zoom: 2 });
  CargoContainers3D.pushShipDeck({ x: FAR.x + 50000, y: FAR.y, angle: 0 }, 'long_haul_freighter', fill.slots, 1);
  CargoContainers3D.end();
  assert.equal(CargoContainers3D.stats.instances, 0, 'poza kadrem');
});

test('limity puli: talia pokładu ≤ 2048, reszta odrzucona bez błędu', () => {
  frame({ zoom: 1, viewHalf: 1e7 });
  const fill = cargoDeckFill('heavy_freighter', { iron_ore: 900 }, 900);
  let pushed = 0;
  for (let i = 0; i < 60; i++) pushed += CargoContainers3D.pushShipDeck({ x: FAR.x + (i % 8) * 2000, y: FAR.y + Math.floor(i / 8) * 1000, angle: 0 }, 'heavy_freighter', fill.slots, i);
  CargoContainers3D.end();
  assert.equal(pushed, CARGO3D_LIMITS.deck);
  assert.equal(CargoContainers3D.stats.deck, CARGO3D_LIMITS.deck);
});

test('scena przeładunku: pokład, niesione, plac i drony z transferState; ≤ 5 wywołań rysowania', () => {
  const bay = createBayLayout({ index: 0 });
  const berth = bay.berths.find((b) => b.size === 'M');
  const ctx = {
    seed: 7, layoutId: 'container_ship', cargo: { chips: 90, coolant: 50 }, capacity: 160, mode: CARGO_MODE.UNLOAD,
    window: cargoTransferWindow({ seconds: 120, moveSeconds: 20 }),
    berth: cargoBerthGeometry(berth, cargoHullExtent('container_ship'))
  };
  const plan = planCargoTransfer(ctx);
  let checked = 0;
  for (let t = 6; t < plan.window.end; t += 3) {
    const st = transferState(plan, t);
    frame({ zoom: 1.5 });
    pushCargoScene(st, plan, { x: FAR.x, y: FAR.y, angle: -0.4 }, { time: t });
    CargoContainers3D.end();
    CargoDrones3D.end();
    const C = CargoContainers3D.stats;
    assert.equal(C.deck, st.onboard, `t=${t}: pokład`);
    assert.equal(C.loose, st.carriedCount, `t=${t}: niesione`);
    assert.equal(C.yard, st.yardCount, `t=${t}: plac`);
    assert.equal(CargoDrones3D.stats.drones, st.droneCount, `t=${t}: drony`);
    assert.ok(C.drawCalls + CargoDrones3D.stats.drawCalls <= 5, `t=${t}: ${C.drawCalls + CargoDrones3D.stats.drawCalls} wywołań`);
    // Światła pozycyjne ma każdy dron w locie (w wyłazie gniazda — jeszcze zgaszone).
    let flying = 0;
    for (let i = 0; i < st.droneCount; i++) if (st.drones[i * CARGO_DRONE_STRIDE + CARGO_DRONE.CLIP] < -1e8) flying++;
    assert.ok(CargoDrones3D.stats.lights >= 2 * flying, `t=${t}: światła pozycyjne ${CargoDrones3D.stats.lights} dla ${flying} dronów`);
    checked++;
  }
  assert.ok(checked > 10);
});

test('widok: paralaksa i ścisk głębi w passie ortho, wolna kamera — prawdziwe z', () => {
  frame({ H: 1234 });
  const U = CargoContainers3D.uniforms;
  assert.equal(U.uCgParallax.value.w, 1);
  assert.equal(U.uCgParallax.value.z, 1234);
  assert.equal(U.uCgDepth.value.y, 1);
  frame({ perspective: true });
  assert.equal(U.uCgParallax.value.w, 0);
  assert.equal(U.uCgDepth.value.y, 0);
  // Materiał kontenerów czyta maskę cieni słońca (pokład statku jak kadłub).
  assert.match(CargoContainers3D.mesh.material.fragmentShader, /sunVisibility\(\)/);
  assert.ok(CARGO3D_TUNE.depthSquash > 0 && CARGO3D_TUNE.depthSquash < 0.1);
});
